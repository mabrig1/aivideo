export type ServiceState = {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
  purpose: string;
};

const yes = (...keys: string[]) =>
  keys.every((key) => Boolean(process.env[key]?.trim()));

const truthy = (key: string) => {
  const value = process.env[key]?.trim().toLowerCase();
  return value === 'true' || value === '1';
};

export function phase1Services(): ServiceState[] {
  return [
    {
      key: 'openrouter',
      label: 'OpenRouter',
      required: true,
      configured: yes('OPENROUTER_API_KEY'),
      purpose: 'Director, agents, structured plans and QC reasoning',
    },
    {
      key: 'nvidia',
      label: 'NVIDIA NIM',
      required: false,
      configured: yes('NVIDIA_API_KEY'),
      purpose: 'Vision/multimodal and configured NVIDIA inference',
    },
    {
      key: 'huggingface',
      label: 'Hugging Face',
      required: false,
      configured: yes('HF_TOKEN'),
      purpose: 'Open-model inference fallback',
    },
    {
      key: 'google-vids',
      label: 'Google Vids quota bridge',
      required: false,
      configured: truthy('GOOGLE_VIDS_BRIDGE_ENABLED'),
      purpose:
        'Authorized access to user-owned Google Vids included quota; separate from Gemini/Veo API billing',
    },
    {
      key: 'gemini-veo',
      label: 'Gemini / Veo API',
      required: false,
      configured: yes('GEMINI_API_KEY'),
      purpose: 'Official Google programmable video generation fallback',
    },
    {
      key: 'runway',
      label: 'Runway API',
      required: false,
      configured: yes('RUNWAY_API_KEY'),
      purpose: 'Official Runway programmable video generation',
    },
    {
      key: 'eden',
      label: 'Eden AI',
      required: false,
      configured: yes('EDENAI_API_KEY'),
      purpose: 'Multi-provider video gateway fallback',
    },
    {
      key: 'comet',
      label: 'CometAPI',
      required: false,
      configured: yes('COMETAPI_API_KEY'),
      purpose: 'Multi-model video gateway fallback',
    },
    {
      key: 'kaggle-import',
      label: 'Kaggle Notebook Import',
      required: false,
      configured: yes(
        'KAGGLE_BRIDGE_TOKEN',
        'R2_ENDPOINT',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET',
      ),
      purpose: 'Owner-only finished media imports from Cinema Tools, Voice Clone, and MuseTalk notebooks',
    },
    {
      key: 'mongodb',
      label: 'MongoDB',
      required: true,
      configured: yes('MONGODB_URI'),
      purpose: 'Durable projects, jobs, stages and artifact metadata',
    },
    {
      key: 'r2',
      label: 'Cloudflare R2',
      required: true,
      configured: yes(
        'R2_ENDPOINT',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET',
      ),
      purpose: 'Audio, references, clips, thumbnails and finished masters',
    },
    {
      key: 'queue',
      label: 'Redis Queue',
      required: true,
      configured: yes('REDIS_URL'),
      purpose: 'Durable long-running generation, retries and repair jobs',
    },
    {
      key: 'gpu',
      label: 'GPU Worker',
      required: true,
      configured: yes('GPU_WORKER_URL', 'GPU_WORKER_TOKEN'),
      purpose:
        'Self-hosted video generation, lip sync, enhancement and FFmpeg mastering',
    },
  ];
}

export function phase1Readiness() {
  const services = phase1Services();
  const required = services.filter((service) => service.required);
  return {
    ready: required.every((service) => service.configured),
    configured: services.filter((service) => service.configured).length,
    total: services.length,
    services,
    domain:
      process.env.NEXT_PUBLIC_APP_URL || 'https://aivideo.mabrigkorie.org',
  };
}
