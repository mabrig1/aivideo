import { getCloudflareContext } from '@opennextjs/cloudflare';
import type {
  ExecutionProviderId,
  ProviderJobStatus,
} from './types';

type R2PutResultLike = {
  etag?: string;
  size?: number;
};

type R2BucketLike = {
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | Blob | string | null,
    options?: {
      httpMetadata?: {
        contentType?: string;
        cacheControl?: string;
      };
      customMetadata?: Record<string, string>;
    },
  ): Promise<R2PutResultLike | null>;
};

type CloudflareVideoEnv = {
  VIDEO_ASSETS?: R2BucketLike;
};

export type PersistedVideoArtifact = {
  key: string;
  providerId: ExecutionProviderId;
  providerJobId: string;
  contentType: string;
  etag?: string;
  size?: number;
};

export type ArtifactPersistenceResult = {
  missionId: string;
  providerId: ExecutionProviderId;
  providerJobId: string;
  artifacts: PersistedVideoArtifact[];
  failures: string[];
};

function configuredAllowedHosts() {
  return (process.env.VIDEO_ARTIFACT_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatches(hostname: string, rule: string) {
  if (rule.startsWith('*.')) {
    const suffix = rule.slice(1);
    return hostname.endsWith(suffix);
  }
  return hostname === rule;
}

function isLiteralOrPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.includes(':')
  ) {
    return true;
  }

  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const octets = match.slice(1).map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return true;

  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function sourceAllowed(providerId: ExecutionProviderId, url: URL) {
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    isLiteralOrPrivateHost(hostname)
  ) {
    return false;
  }

  const configured = configuredAllowedHosts();
  if (configured.some((rule) => hostMatches(hostname, rule))) return true;

  if (providerId === 'gemini-veo') {
    return (
      hostname === 'googleapis.com' ||
      hostname.endsWith('.googleapis.com') ||
      hostname === 'googleusercontent.com' ||
      hostname.endsWith('.googleusercontent.com')
    );
  }

  if (providerId === 'runway') {
    return hostname === 'runwayml.com' || hostname.endsWith('.runwayml.com');
  }

  if (providerId === 'local-wan') {
    const configuredWorker = process.env.GPU_WORKER_URL?.trim();
    if (!configuredWorker) return false;
    try {
      return url.origin === new URL(configuredWorker).origin;
    } catch {
      return false;
    }
  }

  return false;
}

function providerHeaders(providerId: ExecutionProviderId, url: URL) {
  const headers = new Headers();

  if (providerId === 'gemini-veo') {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (key) headers.set('x-goog-api-key', key);
  }

  if (providerId === 'local-wan') {
    const workerUrl = process.env.GPU_WORKER_URL?.trim();
    const token = process.env.GPU_WORKER_TOKEN?.trim();
    if (workerUrl && token) {
      try {
        if (url.origin === new URL(workerUrl).origin) {
          headers.set('Authorization', `Bearer ${token}`);
        }
      } catch {
        // sourceAllowed() rejects malformed worker configuration.
      }
    }
  }

  return headers;
}

function maxArtifactBytes() {
  const value = Number(process.env.VIDEO_ARTIFACT_MAX_BYTES || 536_870_912);
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 536_870_912;
}

function boundedStream(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
) {
  let total = 0;
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(
            new Error(
              `Provider artifact exceeded the configured ${maxBytes}-byte limit.`,
            ),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

function safeSegment(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'unknown'
  );
}

function extensionFor(contentType: string) {
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  if (normalized === 'video/webm') return 'webm';
  if (normalized === 'video/quicktime') return 'mov';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'audio/mpeg') return 'mp3';
  if (normalized === 'audio/wav' || normalized === 'audio/x-wav') return 'wav';
  return 'mp4';
}

async function videoBucket() {
  const context = await getCloudflareContext({ async: true });
  const env = context.env as unknown as CloudflareVideoEnv;
  if (!env.VIDEO_ASSETS) {
    throw new Error(
      'VIDEO_ASSETS R2 binding is not configured for this runtime.',
    );
  }
  return env.VIDEO_ASSETS;
}

async function persistOne(
  bucket: R2BucketLike,
  missionId: string,
  status: ProviderJobStatus,
  source: string,
  index: number,
): Promise<PersistedVideoArtifact> {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source);
  } catch {
    throw new Error('Provider returned an invalid output URL.');
  }

  if (!sourceAllowed(status.providerId, sourceUrl)) {
    throw new Error(
      `Provider output host ${sourceUrl.hostname} is not on the artifact allowlist.`,
    );
  }

  const response = await fetch(sourceUrl, {
    method: 'GET',
    headers: providerHeaders(status.providerId, sourceUrl),
    redirect: 'error',
    cache: 'no-store',
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Provider artifact download failed with HTTP ${response.status}.`,
    );
  }

  const maxBytes = maxArtifactBytes();
  const declaredBytes = Number(response.headers.get('content-length') || 0);
  if (declaredBytes > maxBytes) {
    throw new Error(
      `Provider artifact declares ${declaredBytes} bytes, above the configured ${maxBytes}-byte limit.`,
    );
  }

  const contentType =
    response.headers.get('content-type')?.trim() || 'video/mp4';
  const key = [
    'missions',
    safeSegment(missionId),
    safeSegment(status.providerId),
    safeSegment(status.providerJobId),
    `${String(index + 1).padStart(2, '0')}.${extensionFor(contentType)}`,
  ].join('/');

  const stored = await bucket.put(
    key,
    boundedStream(response.body, maxBytes),
    {
      httpMetadata: {
        contentType,
        cacheControl: 'private, no-store',
      },
      customMetadata: {
        missionId: safeSegment(missionId),
        providerId: status.providerId,
        providerJobId: safeSegment(status.providerJobId),
      },
    },
  );

  if (!stored) {
    throw new Error('R2 rejected the artifact write.');
  }

  return {
    key,
    providerId: status.providerId,
    providerJobId: status.providerJobId,
    contentType,
    etag: stored.etag,
    size: stored.size,
  };
}

export async function persistProviderOutputs(
  missionId: string,
  status: ProviderJobStatus,
): Promise<ArtifactPersistenceResult> {
  const normalizedMissionId = missionId?.trim().slice(0, 120);
  if (!normalizedMissionId) throw new Error('missionId is required.');

  if (status.status !== 'succeeded') {
    throw new Error('Provider job must succeed before outputs can be persisted.');
  }
  if (!status.outputUrls.length) {
    throw new Error('Provider job succeeded without output URLs.');
  }

  const bucket = await videoBucket();
  const artifacts: PersistedVideoArtifact[] = [];
  const failures: string[] = [];

  for (const [index, source] of status.outputUrls.slice(0, 6).entries()) {
    try {
      artifacts.push(
        await persistOne(bucket, normalizedMissionId, status, source, index),
      );
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error.message
          : 'Provider artifact persistence failed.',
      );
    }
  }

  return {
    missionId: normalizedMissionId,
    providerId: status.providerId,
    providerJobId: status.providerJobId,
    artifacts,
    failures,
  };
}
