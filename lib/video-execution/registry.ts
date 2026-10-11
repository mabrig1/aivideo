import { geminiVeoAdapter } from './adapters/gemini-veo';
import { localGpuAdapter } from './adapters/local-gpu';
import { museTalkAdapter } from './adapters/musetalk';
import { runwayAdapter } from './adapters/runway';
import type {
  ExecutionProviderId,
  VideoExecutionAdapter,
} from './types';

const adapters: Record<ExecutionProviderId, VideoExecutionAdapter> = {
  'local-wan': localGpuAdapter,
  'local-musetalk': museTalkAdapter,
  'gemini-veo': geminiVeoAdapter,
  runway: runwayAdapter,
};

export function executionAdapter(providerId: ExecutionProviderId) {
  return adapters[providerId];
}

export function executionAdapters() {
  return Object.values(adapters);
}
