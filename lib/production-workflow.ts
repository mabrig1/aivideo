export type StageStatus =
  | 'queued'
  | 'working'
  | 'reviewing'
  | 'approved'
  | 'blocked'
  | 'published';

export type ProductionStage = {
  id: string;
  agent: string;
  mission: string;
  status: StageStatus;
  attempt: number;
  qualityGate?: string;
};

export type Destination =
  | 'youtube'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'website';

export type ProductionRouting = {
  mode: 'free-only' | 'free-preferred' | 'commercial-safe' | 'best-quality';
  selectedProviderId: string | null;
  requiresHumanApproval: boolean;
  warnings: string[];
  requestedAspectRatio?: string;
  generationAspectRatio?: string;
  finishingStrategy?: string;
};

export type ProductionJob = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  brief: string;
  template: string;
  ratio: string;
  audioName: string;
  referenceCount: number;
  stageIndex: number;
  stages: ProductionStage[];
  destinations: Destination[];
  publishMode: 'review-first' | 'auto-publish';
  state:
    | 'running'
    | 'awaiting-approval'
    | 'publishing'
    | 'published'
    | 'blocked';
  routing?: ProductionRouting;
  outputs: {
    master?: string;
    vertical?: string;
    thumbnail?: string;
    caption?: string;
  };
  events: string[];
};

export const AGENT_PIPELINE: Omit<
  ProductionStage,
  'status' | 'attempt'
>[] = [
  {
    id: 'ingest',
    agent: 'Executive Producer',
    mission:
      'Validate audio, references, rights/consent, brief and delivery targets.',
  },
  {
    id: 'music',
    agent: 'Music Intelligence',
    mission:
      'Map tempo, sections, energy, lyrics, vocal entries and edit points.',
  },
  {
    id: 'director',
    agent: 'Creative Director',
    mission:
      'Convert the instruction into a cinematic treatment, visual arc and shot plan.',
  },
  {
    id: 'router',
    agent: 'Video Provider Router',
    mission:
      'Select the safest eligible generation route using capability, health, quota, cost and rights policy.',
    qualityGate:
      'Never assume unknown quota or API cost is free; paid execution requires explicit permission.',
  },
  {
    id: 'identity',
    agent: 'Identity & Continuity',
    mission:
      'Build the approved artist identity pack and enforce face, wardrobe and scene continuity.',
    qualityGate: 'Reject identity drift.',
  },
  {
    id: 'performance',
    agent: 'Performance Director',
    mission:
      'Generate performance coverage only where vocals require visible singing.',
  },
  {
    id: 'lipsync',
    agent: 'Lip-Sync Supervisor',
    mission:
      'Align phonemes, mouth shapes, facial motion and vocal timing.',
    qualityGate:
      'Repair or regenerate any visibly unsynchronised performance shot.',
  },
  {
    id: 'broll',
    agent: 'Cinematographer',
    mission:
      'Generate lyric-aware B-roll, establishing shots, inserts and transitions.',
  },
  {
    id: 'edit',
    agent: 'Editor',
    mission:
      'Assemble beat-aware picture edit while protecting vocal continuity and emotional pacing.',
  },
  {
    id: 'finish',
    agent: 'Finishing Artist',
    mission:
      'Apply colour, reframing, subtitles, titles, audio master and platform-safe exports.',
  },
  {
    id: 'qc',
    agent: 'QC Critic',
    mission:
      'Score identity, lip sync, continuity, artifacts, audio, captions and platform compliance.',
    qualityGate:
      'Failed dimensions loop to the responsible agent; do not approve weak shots.',
  },
  {
    id: 'campaign',
    agent: 'Campaign Agent',
    mission:
      'Create title, description, caption, hashtags, thumbnail brief, credits and website copy.',
  },
  {
    id: 'publish',
    agent: 'Distribution Agent',
    mission:
      'Publish approved masters to connected destinations and verify resulting post URLs.',
  },
];

const jobs = new Map<string, ProductionJob>();
const stamp = () => new Date().toISOString();

export function createProduction(input: {
  title?: string;
  brief: string;
  template: string;
  ratio: string;
  audioName: string;
  referenceCount: number;
  destinations: Destination[];
  publishMode: 'review-first' | 'auto-publish';
  routing?: ProductionRouting;
}) {
  const now = stamp();
  const id = `mv_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const routeSummary = input.routing
    ? input.routing.selectedProviderId
      ? ` Video route: ${input.routing.selectedProviderId} (${input.routing.mode}).`
      : ` Video route unresolved (${input.routing.mode}).`
    : '';
  const ratioSummary =
    input.routing?.requestedAspectRatio &&
    input.routing?.generationAspectRatio &&
    input.routing.requestedAspectRatio !== input.routing.generationAspectRatio
      ? ` Generation ratio ${input.routing.generationAspectRatio}; master ratio ${input.routing.requestedAspectRatio}.`
      : '';

  const job: ProductionJob = {
    id,
    createdAt: now,
    updatedAt: now,
    title: input.title || input.audioName.replace(/\.[^.]+$/, ''),
    brief: input.brief,
    template: input.template,
    ratio: input.ratio,
    audioName: input.audioName,
    referenceCount: input.referenceCount,
    stageIndex: 0,
    stages: AGENT_PIPELINE.map((stage, index) => ({
      ...stage,
      status: index === 0 ? 'working' : 'queued',
      attempt: 0,
    })),
    destinations: input.destinations,
    publishMode: input.publishMode,
    state: 'running',
    routing: input.routing,
    outputs: {},
    events: [
      `${now} Production assigned to autonomous crew.${routeSummary}${ratioSummary}`,
      ...(input.routing?.finishingStrategy
        ? [`${now} Finishing plan: ${input.routing.finishingStrategy}`]
        : []),
      ...(input.routing?.warnings ?? []).map(
        (warning) => `${now} Router warning: ${warning}`,
      ),
    ],
  };

  jobs.set(id, job);
  return job;
}

export function getProduction(id: string) {
  return jobs.get(id);
}

export function advanceProduction(id: string) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.state === 'published' || job.state === 'blocked') return job;

  const current = job.stages[job.stageIndex];
  if (!current) return job;

  if (
    current.id === 'router' &&
    job.routing?.requiresHumanApproval
  ) {
    current.status = 'reviewing';
    job.state = 'awaiting-approval';
    job.events.push(
      `${stamp()} Video Provider Router paused for scoped human approval.`,
    );
    job.updatedAt = stamp();
    return job;
  }

  if (
    current.id === 'router' &&
    job.routing &&
    !job.routing.selectedProviderId
  ) {
    current.status = 'blocked';
    job.state = 'blocked';
    job.events.push(
      `${stamp()} Video Provider Router blocked production: no eligible provider route.`,
    );
    job.updatedAt = stamp();
    return job;
  }

  current.status = 'approved';
  current.attempt += 1;
  job.events.push(`${stamp()} ${current.agent} approved ${current.id}.`);

  if (current.id === 'finish') {
    const masterRatio =
      job.routing?.requestedAspectRatio || job.ratio || '16:9';
    job.outputs.master = `master://${job.id}/${masterRatio}.mp4`;
    job.outputs.vertical = `master://${job.id}/9x16.mp4`;
    job.outputs.thumbnail = `master://${job.id}/thumbnail.jpg`;
  }

  if (current.id === 'campaign') {
    job.outputs.caption = `${job.title} — ${job.brief}`;
  }

  if (current.id === 'qc' && job.publishMode === 'review-first') {
    job.state = 'awaiting-approval';
    job.updatedAt = stamp();
    return job;
  }

  job.stageIndex += 1;
  const next = job.stages[job.stageIndex];

  if (next) {
    next.status = next.id === 'publish' ? 'reviewing' : 'working';
    job.state = next.id === 'publish' ? 'publishing' : 'running';
  } else {
    job.state = 'published';
  }

  job.updatedAt = stamp();
  return job;
}

export function approveAndContinue(id: string) {
  const job = jobs.get(id);
  if (!job) return null;

  if (job.state === 'awaiting-approval') {
    const current = job.stages[job.stageIndex];

    if (current?.id === 'router') {
      current.status = 'approved';
      current.attempt += 1;
      job.events.push(
        `${stamp()} Human approval received for routed provider execution.`,
      );
    } else {
      job.events.push(`${stamp()} Human approval received.`);
    }

    job.state = 'running';
    job.stageIndex += 1;
    const next = job.stages[job.stageIndex];
    if (next) next.status = 'working';
  }

  job.updatedAt = stamp();
  return job;
}

export function markPublished(
  id: string,
  urls: Partial<Record<Destination, string>>,
) {
  const job = jobs.get(id);
  if (!job) return null;

  const publishStage = job.stages.find((stage) => stage.id === 'publish');
  if (publishStage) publishStage.status = 'published';
  job.state = 'published';
  job.stageIndex = job.stages.length;

  Object.entries(urls).forEach(([destination, url]) =>
    job.events.push(`${stamp()} Published ${destination}: ${url}`),
  );

  job.updatedAt = stamp();
  return job;
}
