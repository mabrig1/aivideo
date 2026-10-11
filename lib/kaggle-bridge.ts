import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { bridgeReady, MIN_BRIDGE_TOKEN_LENGTH } from './kaggle-config';
export { bridgeReady } from './kaggle-config';

export const KAGGLE_PIPELINES = [
  {
    id: 'cinema',
    title: 'Mabrig Cinema Tools',
    notebookUrl: 'https://www.kaggle.com/code/mabrigkorie/mabrig-cinema-tools',
    model: 'Wan 2.1 / cinematic scenes / FFmpeg',
    purpose: 'Generate short cinematic motion clips, then assemble them with the licensed song.',
    expectedTypes: ['mp4', 'webm', 'png', 'jpg'],
    artifactHint: '/kaggle/working/wan_broll/WAN_PADDLERS_01.mp4',
  },
  {
    id: 'voice',
    title: 'Mabrig Voice Clone',
    notebookUrl: 'https://www.kaggle.com/code/mabrigkorie/mabrig-voice-clone/edit',
    model: 'Consented voice processing',
    purpose: 'Prepare or clone the authorized artist voice, exporting usable audio files.',
    expectedTypes: ['wav', 'mp3', 'm4a'],
    artifactHint: '/kaggle/working/<your-generated-voice>.wav',
  },
  {
    id: 'musetalk',
    title: 'MuseTalk',
    notebookUrl: 'https://www.kaggle.com/code/mabrigkorie/muse-talk',
    model: 'Lip-sync / video portrait',
    purpose: 'Align approved portrait performance with the prepared voice or song.',
    expectedTypes: ['mp4', 'webm'],
    artifactHint: '/kaggle/working/<your-musetalk-output>.mp4',
  },
] as const;

export type KagglePipelineId = (typeof KAGGLE_PIPELINES)[number]['id'];
export type KaggleArtifact = {
  id: string;
  pipeline: KagglePipelineId;
  projectId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  key: string;
  completedAt: string;
  etag: string | null;
};

const contentTypes: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024;
const OUTPUT_PREFIX = 'kaggle/outputs';
const INDEX_PREFIX = 'kaggle/manifests';

export class KaggleInputError extends Error {}

export function bridgeAuthorized(header: string | null): boolean {
  const secret = process.env.KAGGLE_BRIDGE_TOKEN?.trim() || '';
  if (secret.length < MIN_BRIDGE_TOKEN_LENGTH || !header?.startsWith('Bearer ')) return false;
  const supplied = header.slice(7);
  const givenBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(secret);
  return givenBytes.length === expectedBytes.length &&
    timingSafeEqual(givenBytes, expectedBytes);
}

function r2() {
  if (!bridgeReady()) throw new Error('Kaggle bridge storage is not configured.');
  const endpoint = process.env.R2_ENDPOINT!.trim();
  if (!endpoint.startsWith('https://')) throw new Error('R2_ENDPOINT must use HTTPS');
  return {
    bucket: process.env.R2_BUCKET!.trim(),
    client: new S3Client({
      region: 'auto',
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      endpoint,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
      },
    }),
  };
}

function mac(key: string, pipeline: string, projectId: string, filename: string, sizeBytes: number, contentType: string, expiresAt: number) {
  return createHmac('sha256', process.env.KAGGLE_BRIDGE_TOKEN!.trim())
    .update(JSON.stringify([2, key, pipeline, projectId, filename, sizeBytes, contentType, expiresAt]))
    .digest('hex');
}

export function parseArtifactInput(input: unknown) {
  if (!input || typeof input !== 'object') throw new KaggleInputError('Artifact details are required.');
  const data = input as Record<string, unknown>;
  const pipeline = String(data.pipeline || '') as KagglePipelineId;
  const entry = KAGGLE_PIPELINES.find((item) => item.id === pipeline);
  if (!entry) throw new KaggleInputError('Unknown Kaggle pipeline.');
  if (data.consentConfirmed !== true) {
    throw new KaggleInputError('Confirm that you have permission to use the voice, likeness, and audio.');
  }
  const projectId = String(data.projectId || 'mabrig-cinema');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(projectId)) {
    throw new KaggleInputError('projectId must contain only letters, digits, underscores or dashes.');
  }
  const name = String(data.filename || '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,119}$/.test(name) || name.includes('..')) {
    throw new KaggleInputError('Use a simple filename without directories or traversal sequences.');
  }
  const extension = name.split('.').pop()?.toLowerCase() || '';
  if (!entry.expectedTypes.some((kind) => kind === extension) || !contentTypes[extension]) {
    throw new KaggleInputError('This pipeline does not accept the requested file type.');
  }
  const sizeBytes = Number(data.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_ARTIFACT_BYTES) {
    throw new KaggleInputError('Artifact size must be between 1 byte and 1 GiB.');
  }
  return { pipeline, projectId, filename: name, sizeBytes, contentType: contentTypes[extension] };
}

export async function prepareArtifact(input: unknown) {
  const validated = parseArtifactInput(input);
  const id = randomUUID();
  const safeName = validated.filename.replace(/\s+/g, '-');
  const key = `${OUTPUT_PREFIX}/${validated.pipeline}/${id}/${safeName}`;
  const { bucket, client } = r2();
  const put = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: validated.contentType,
    ContentLength: validated.sizeBytes,
    IfNoneMatch: '*',
  });
  const expiresAt = Math.floor(Date.now() / 1000) + 1800;
  const uploadUrl = await getSignedUrl(client, put, {
    expiresIn: 900,
    signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']),
  });
  return {
    ...validated, id, key, uploadUrl, expiresInSeconds: 900, expiresAt,
    version: 2,
    uploadHeaders: { 'Content-Type': validated.contentType, 'Content-Length': String(validated.sizeBytes), 'If-None-Match': '*' },
    proof: mac(key, validated.pipeline, validated.projectId, validated.filename, validated.sizeBytes, validated.contentType, expiresAt),
    instructions: 'PUT raw bytes with all uploadHeaders, then complete with the receipt before expiresAt.',
  };
}

export async function completeArtifact(input: unknown): Promise<KaggleArtifact> {
  if (!input || typeof input !== 'object') throw new KaggleInputError('Completion receipt required.');
  const data = input as Record<string, unknown>;
  const parsed = parseArtifactInput({ ...data, consentConfirmed: true });
  const id = String(data.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new KaggleInputError('Invalid upload id.');
  const safeName = parsed.filename.replace(/\s+/g, '-');
  const key = `${OUTPUT_PREFIX}/${parsed.pipeline}/${id}/${safeName}`;
  const expiresAt = Number(data.expiresAt);
  if (data.version !== 2 || !Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new KaggleInputError('Upload receipt expired or obsolete. Prepare a fresh upload with the current uploader.');
  }
  const proof = String(data.proof || '');
  const expected = mac(key, parsed.pipeline, parsed.projectId, parsed.filename, parsed.sizeBytes, parsed.contentType, expiresAt);
  const bytes = Buffer.from(proof);
  const expectedBytes = Buffer.from(expected);
  if (bytes.length !== expectedBytes.length || !timingSafeEqual(bytes, expectedBytes)) {
    throw new KaggleInputError('Invalid or modified upload receipt.');
  }
  const { bucket, client } = r2();
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (head.ContentLength !== parsed.sizeBytes ||
      (head.ContentType || '').split(';')[0].toLowerCase() !== parsed.contentType) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    throw new KaggleInputError('Uploaded object did not match its receipt and was removed. Prepare a fresh upload.');
  }
  const manifestKey = `${INDEX_PREFIX}/${parsed.pipeline}/${id}.json`;
  try {
    const existing = await client.send(new GetObjectCommand({ Bucket: bucket, Key: manifestKey }));
    const artifact = JSON.parse(await existing.Body?.transformToString() || '{}') as KaggleArtifact;
    if (artifact.key !== key || artifact.etag !== (head.ETag || null)) throw new Error('Stored artifact conflict.');
    return artifact;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const artifact: KaggleArtifact = {
    id,
    pipeline: parsed.pipeline,
    projectId: parsed.projectId,
    filename: parsed.filename,
    sizeBytes: parsed.sizeBytes,
    contentType: parsed.contentType,
    key,
    completedAt: new Date().toISOString(),
    etag: head.ETag || null,
  };
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: manifestKey,
      IfNoneMatch: '*',
      ContentType: 'application/json',
      Body: JSON.stringify(artifact),
    }));
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode !== 412) throw error;
    const stored = await client.send(new GetObjectCommand({ Bucket: bucket, Key: manifestKey }));
    const winner = JSON.parse(await stored.Body?.transformToString() || '{}') as KaggleArtifact;
    if (winner.key !== key || winner.etag !== artifact.etag) throw new Error('Stored artifact conflict.');
    return winner;
  }
  return artifact;
}

export async function listArtifacts(pipeline?: string, cursor?: string) {
  if (pipeline && !KAGGLE_PIPELINES.some((item) => item.id === pipeline)) {
    throw new KaggleInputError('Unknown Kaggle pipeline.');
  }
  if (cursor && (cursor.length > 2048 || /[\x00-\x1f]/.test(cursor))) throw new KaggleInputError('Invalid page cursor.');
  const { bucket, client } = r2();
  const prefix = pipeline ? `${INDEX_PREFIX}/${pipeline}/` : `${INDEX_PREFIX}/`;
  const items = await client.send(new ListObjectsV2Command({
    Bucket: bucket, Prefix: prefix, MaxKeys: 50, ContinuationToken: cursor,
  }));
  const keys = (items.Contents || []).flatMap((item) =>
    item.Key?.endsWith('.json') ? [item.Key] : []);
  const manifests = await Promise.all(keys.map(async (key) => {
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const manifest = JSON.parse(await result.Body?.transformToString() || '{}') as KaggleArtifact;
      if (!validManifest(manifest, key)) return null;
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: manifest.key, IfMatch: manifest.etag || undefined }));
      } catch (error) {
        if (isMissing(error) || (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412) return null;
        throw error;
      }
      const downloadUrl = await getSignedUrl(client, new GetObjectCommand({
        Bucket: bucket, Key: manifest.key,
      }), { expiresIn: 600 });
      return {
        id: manifest.id, pipeline: manifest.pipeline, projectId: manifest.projectId,
        filename: manifest.filename, sizeBytes: manifest.sizeBytes,
        completedAt: manifest.completedAt, downloadUrl,
      };
    } catch (error) {
      if (isMissing(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }));
  return {
    assets: manifests.filter((item) => item !== null).sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
    nextCursor: items.IsTruncated ? items.NextContinuationToken || null : null,
  };
}

function isMissing(error: unknown) {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;
}

function validManifest(value: KaggleArtifact, manifestKey: string): boolean {
  try {
    const parsed = parseArtifactInput({ ...value, consentConfirmed: true });
    return /^[0-9a-f-]{36}$/.test(value.id) &&
      manifestKey === `${INDEX_PREFIX}/${parsed.pipeline}/${value.id}.json` &&
      value.key === `${OUTPUT_PREFIX}/${parsed.pipeline}/${value.id}/${parsed.filename.replace(/\s+/g, '-')}` &&
      value.contentType === parsed.contentType && Number.isFinite(Date.parse(value.completedAt));
  } catch { return false; }
}

export async function checkBridgeStorage() {
  const { bucket, client } = r2();
  await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${INDEX_PREFIX}/`, MaxKeys: 1 }));
  return { storageListVerified: true, writeVerified: false, bucketPrivacyVerified: false,
    message: 'Storage listing succeeded. A test import is still required to verify upload and download; check bucket privacy in Cloudflare.' };
}
