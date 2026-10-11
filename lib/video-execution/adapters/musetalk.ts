import { fetchJson } from '../http';
import type {
  ProviderJobStatus,
  ProviderPreflight,
  ProviderSubmission,
  VideoExecutionAdapter,
  VideoExecutionInput,
} from '../types';

type WorkerHealth = { ok?: boolean; generationReady?: boolean; detail?: string };
type WorkerSubmit = { accepted?: boolean; jobId?: string; status?: string; note?: string };
type WorkerStatus = { status?: string; outputUrls?: string[]; error?: string };

const baseUrl = () => process.env.GPU_WORKER_URL?.trim().replace(/\/$/, '') || '';
const token = () => process.env.GPU_WORKER_TOKEN?.trim() || '';
const headers = (): Record<string, string> =>
  token() ? { Authorization: `Bearer ${token()}` } : {};

export const museTalkAdapter: VideoExecutionAdapter = {
  providerId: 'local-musetalk',
  metered: false,

  configured() {
    return Boolean(baseUrl() && token());
  },

  async preflight(input: VideoExecutionInput): Promise<ProviderPreflight> {
    if (!this.configured()) {
      return { ok: false, providerId: 'local-musetalk', detail: 'GPU worker URL/token are not configured.' };
    }
    if (!input.audioUrl) {
      return { ok: false, providerId: 'local-musetalk', detail: 'MuseTalk requires audioUrl.' };
    }
    if (!input.sourceVideoUrl && !input.sourceImageUrl && !(input.referenceImageUrls || []).length) {
      return { ok: false, providerId: 'local-musetalk', detail: 'MuseTalk requires a presenter image or video.' };
    }

    const health = await fetchJson<WorkerHealth>(
      `${baseUrl()}/health`,
      { method: 'GET', headers: headers() },
      10_000,
    );
    return {
      ok: Boolean(health.ok && health.generationReady),
      providerId: 'local-musetalk',
      detail: health.ok && health.generationReady
        ? 'MuseTalk worker path is reachable and generation-ready.'
        : health.detail || 'GPU worker is not generation-ready.',
      model: 'MuseTalk',
    };
  },

  async submit(input: VideoExecutionInput): Promise<ProviderSubmission> {
    const result = await fetchJson<WorkerSubmit>(
      `${baseUrl()}/jobs`,
      {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: input.missionId,
          engine: 'musetalk',
          audio_url: input.audioUrl || '',
          source_image_url: input.sourceImageUrl || '',
          source_video_url: input.sourceVideoUrl || '',
          reference_urls: input.referenceImageUrls || [],
          brief: input.prompt,
          aspect_ratio: input.aspectRatio,
        }),
      },
      20_000,
    );
    if (!result.accepted || !result.jobId) throw new Error(result.note || 'MuseTalk worker rejected the job.');
    return {
      providerId: 'local-musetalk',
      providerJobId: result.jobId,
      status: result.status === 'working' ? 'working' : 'queued',
      model: 'MuseTalk',
      metadata: { engine: 'musetalk' },
    };
  },

  async status(providerJobId: string): Promise<ProviderJobStatus> {
    const result = await fetchJson<WorkerStatus>(
      `${baseUrl()}/jobs/${encodeURIComponent(providerJobId)}`,
      { method: 'GET', headers: headers() },
      10_000,
    );
    const raw = String(result.status || '').toLowerCase();
    const status = raw === 'succeeded' ? 'succeeded' : raw === 'failed' ? 'failed' : raw === 'working' ? 'working' : 'queued';
    return {
      providerId: 'local-musetalk',
      providerJobId,
      status,
      outputUrls: result.outputUrls || [],
      error: result.error,
      metadata: { engine: 'musetalk' },
    };
  },
};
