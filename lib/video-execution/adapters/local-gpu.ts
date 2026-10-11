import { fetchJson } from '../http';
import type {
  ProviderJobStatus,
  ProviderPreflight,
  ProviderSubmission,
  VideoExecutionAdapter,
  VideoExecutionInput,
} from '../types';

type WorkerHealth = {
  ok?: boolean;
  generationReady?: boolean;
  detail?: string;
};

type WorkerSubmit = {
  accepted?: boolean;
  jobId?: string;
  projectId?: string;
  status?: string;
  note?: string;
};

type WorkerStatus = {
  jobId?: string;
  status?: string;
  outputUrls?: string[];
  error?: string;
};

function baseUrl() {
  return process.env.GPU_WORKER_URL?.trim().replace(/\/$/, '') || '';
}

function token() {
  return process.env.GPU_WORKER_TOKEN?.trim() || '';
}

function headers(): Record<string, string> {
  return token() ? { Authorization: `Bearer ${token()}` } : {};
}

export const localGpuAdapter: VideoExecutionAdapter = {
  providerId: 'local-wan',
  metered: false,

  configured() {
    return Boolean(baseUrl() && token());
  },

  async preflight(): Promise<ProviderPreflight> {
    if (!this.configured()) {
      return {
        ok: false,
        providerId: 'local-wan',
        detail: 'GPU worker URL/token are not configured.',
      };
    }

    const health = await fetchJson<WorkerHealth>(
      `${baseUrl()}/health`,
      { method: 'GET', headers: headers() },
      10_000,
    );

    if (!health.ok || !health.generationReady) {
      return {
        ok: false,
        providerId: 'local-wan',
        detail:
          health.detail ||
          'GPU worker is reachable but has no generation backend configured.',
      };
    }

    return {
      ok: true,
      providerId: 'local-wan',
      detail: 'Local GPU worker reports generation-ready.',
    };
  },

  async submit(input: VideoExecutionInput): Promise<ProviderSubmission> {
    const result = await fetchJson<WorkerSubmit>(
      `${baseUrl()}/jobs`,
      {
        method: 'POST',
        headers: {
          ...headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_id: input.missionId,
          audio_url: input.audioUrl || '',
          reference_urls: input.referenceImageUrls || [],
          brief: input.prompt,
          aspect_ratio: input.aspectRatio,
          engine: 'wan',
          source_image_url: input.sourceImageUrl || '',
          source_video_url: input.sourceVideoUrl || '',
        }),
      },
      20_000,
    );

    if (!result.accepted || !result.jobId) {
      throw new Error(
        result.note || 'GPU worker did not accept a generation job.',
      );
    }

    return {
      providerId: 'local-wan',
      providerJobId: result.jobId,
      status: result.status === 'working' ? 'working' : 'queued',
    };
  },

  async status(providerJobId: string): Promise<ProviderJobStatus> {
    const result = await fetchJson<WorkerStatus>(
      `${baseUrl()}/jobs/${encodeURIComponent(providerJobId)}`,
      { method: 'GET', headers: headers() },
      10_000,
    );

    const status = String(result.status || '').toLowerCase();
    const normalized =
      status === 'succeeded'
        ? 'succeeded'
        : status === 'failed'
          ? 'failed'
          : status === 'working'
            ? 'working'
            : 'queued';

    return {
      providerId: 'local-wan',
      providerJobId,
      status: normalized,
      outputUrls: result.outputUrls || [],
      error: result.error,
    };
  },
};
