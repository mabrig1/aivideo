import { fetchJson } from '../http';
import type {
  ProviderJobStatus,
  ProviderPreflight,
  ProviderSubmission,
  VideoExecutionAdapter,
  VideoExecutionInput,
} from '../types';

const BASE_URL = 'https://api.dev.runwayml.com/v1';
const API_VERSION = '2024-11-06';

type RunwayRouting = {
  model?: string;
  estimatedCost?: number;
  resolvedSettings?: Record<string, unknown>;
};

type RunwayResponse = {
  id?: string;
  status?: string;
  output?: string[];
  failure?: string;
  failureCode?: string;
  routing?: RunwayRouting;
};

function secret() {
  return (
    process.env.RUNWAYML_API_SECRET?.trim() ||
    process.env.RUNWAY_API_KEY?.trim() ||
    ''
  );
}

function configId() {
  return process.env.RUNWAY_ROUTER_CONFIG_ID?.trim() || '';
}

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${secret()}`,
    'X-Runway-Version': API_VERSION,
  };
}

function payload(input: VideoExecutionInput, dryRun: boolean) {
  return {
    configId: configId(),
    ...(dryRun ? { dryRun: true } : {}),
    input: {
      promptText: input.prompt,
      aspectRatio: input.aspectRatio,
      duration: input.durationSeconds,
      ...(input.sourceImageUrl
        ? {
            referenceImages: [
              { uri: input.sourceImageUrl, role: 'first' },
            ],
          }
        : {}),
    },
  };
}

export const runwayAdapter: VideoExecutionAdapter = {
  providerId: 'runway',
  metered: true,

  configured() {
    return Boolean(secret() && configId());
  },

  async preflight(input: VideoExecutionInput): Promise<ProviderPreflight> {
    if (!secret()) {
      return {
        ok: false,
        providerId: 'runway',
        detail:
          'RUNWAYML_API_SECRET (or legacy RUNWAY_API_KEY) is not configured.',
      };
    }

    if (!configId()) {
      return {
        ok: false,
        providerId: 'runway',
        detail:
          'RUNWAY_ROUTER_CONFIG_ID is required so Runway can dry-run the exact routed request before billing.',
      };
    }

    const result = await fetchJson<RunwayResponse>(
      `${BASE_URL}/generate/video`,
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload(input, true)),
      },
      25_000,
    );

    const estimatedCredits = result.routing?.estimatedCost;
    if (typeof estimatedCredits !== 'number' || !Number.isFinite(estimatedCredits) || estimatedCredits < 0) {
      return {
        ok: false,
        providerId: 'runway',
        detail:
          'Runway dry-run did not return an estimated credit cost; execution is blocked rather than guessing.',
        model: result.routing?.model,
      };
    }

    const requestedCap =
      typeof input.maxRunwayCredits === 'number'
        ? input.maxRunwayCredits
        : Number(process.env.RUNWAY_MAX_CREDITS_PER_GENERATION || 0);

    const serverCap = Number(process.env.RUNWAY_MAX_CREDITS_PER_GENERATION || 0);
    const cap = serverCap > 0 ? Math.min(requestedCap, serverCap) : requestedCap;

    if (!(cap > 0) || !Number.isFinite(cap)) {
      return {
        ok: false,
        providerId: 'runway',
        detail:
          'Set maxRunwayCredits for the request or RUNWAY_MAX_CREDITS_PER_GENERATION on the server before paid execution.',
        estimatedCredits,
        model: result.routing?.model,
      };
    }

    if (estimatedCredits > cap) {
      return {
        ok: false,
        providerId: 'runway',
        detail: `Runway dry-run estimated ${estimatedCredits} credits, above the approved cap of ${cap}.`,
        estimatedCredits,
        model: result.routing?.model,
      };
    }

    return {
      ok: true,
      providerId: 'runway',
      detail: `Runway dry-run approved at an estimated ${estimatedCredits} credits (cap ${cap}).`,
      estimatedCredits,
      model: result.routing?.model,
    };
  },

  async submit(input: VideoExecutionInput): Promise<ProviderSubmission> {
    const result = await fetchJson<RunwayResponse>(
      `${BASE_URL}/generate/video`,
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload(input, false)),
      },
      30_000,
    );

    if (!result.id) {
      throw new Error('Runway did not return a task ID.');
    }

    return {
      providerId: 'runway',
      providerJobId: result.id,
      status: 'queued',
      model: result.routing?.model,
      estimatedCredits: result.routing?.estimatedCost,
      metadata: result.routing?.resolvedSettings
        ? { resolvedSettings: result.routing.resolvedSettings }
        : undefined,
    };
  },

  async status(providerJobId: string): Promise<ProviderJobStatus> {
    const task = await fetchJson<RunwayResponse>(
      `${BASE_URL}/tasks/${encodeURIComponent(providerJobId)}`,
      {
        method: 'GET',
        headers: headers(),
      },
      20_000,
    );

    const status = String(task.status || '').toUpperCase();
    if (status === 'SUCCEEDED') {
      return {
        providerId: 'runway',
        providerJobId,
        status: 'succeeded',
        outputUrls: Array.isArray(task.output) ? task.output : [],
        metadata: {
          ephemeralOutput: true,
          persistenceRequired: true,
        },
      };
    }

    if (status === 'FAILED' || status === 'CANCELED') {
      return {
        providerId: 'runway',
        providerJobId,
        status: 'failed',
        outputUrls: [],
        error: task.failure || task.failureCode || `Runway task ${status}.`,
      };
    }

    return {
      providerId: 'runway',
      providerJobId,
      status: status === 'PENDING' ? 'queued' : 'working',
      outputUrls: [],
    };
  },
};
