/** Conservative, read-only source catalog. This is NOT a list of free API quotas. */
export type VideoModelCandidate = {
  id: string;
  label: string;
  officialUrl: string;
  origin: 'huggingface' | 'curated';
  access: 'open-weights' | 'official-api' | 'unknown';
  freeCloudCredits: 'unverified' | 'none-confirmed';
  apiIntegration: 'review-required' | 'not-connected';
  note: string;
};
export const CURATED_VIDEO_MODELS: VideoModelCandidate[] = [
  {id:'Wan-AI/Wan2.1-T2V-1.3B-Diffusers',label:'Wan2.1 T2V 1.3B',
    officialUrl:'https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers',
    origin:'curated',access:'open-weights',freeCloudCredits:'unverified',
    apiIntegration:'review-required',
    note:'Open model weights can be self-hosted; GPU inference and storage may cost money. Existing private Wan adapter requires explicit GPU setup.'},
  {id:'Lightricks/LTX-Video',label:'LTX Video',
    officialUrl:'https://huggingface.co/Lightricks/LTX-Video',origin:'curated',
    access:'open-weights',freeCloudCredits:'unverified',
    apiIntegration:'not-connected',
    note:'Open-weight video research family. Verify the exact checkpoint license and GPU needs before use.'},
  {id:'THUDM/CogVideoX-2b',label:'CogVideoX 2B',
    officialUrl:'https://huggingface.co/THUDM/CogVideoX-2b',origin:'curated',
    access:'open-weights',freeCloudCredits:'unverified',
    apiIntegration:'not-connected',
    note:'Potential self-hosted route; confirm checkpoint availability, license and actual runtime.'},
];
export function safeHfCandidate(raw: unknown): VideoModelCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const x = raw as Record<string, unknown>;
  const id = typeof x.id === 'string' ? x.id : typeof x.modelId === 'string' ? x.modelId : '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(id) || id.length > 150) return null;
  const words = /(?:wan|ltx|cogvideo|hunyuan.?video|mochi|skyreels|videocrafter|animatediff)/i;
  if (!words.test(id)) return null;
  if (x.private === true || x.gated === true || x.gated === 'auto' || x.gated === 'manual') return null;
  return {id,label:id.split('/')[1],officialUrl:'https://huggingface.co/'+id,
    origin:'huggingface',access:'unknown',freeCloudCredits:'unverified',
    apiIntegration:'not-connected',
    note:'Public model-card discovery only. Free API usage, inference readiness, commercial rights and monthly quota have not been verified.'};
}
export function extractVideoCandidates(records: unknown): VideoModelCandidate[] {
  if (!Array.isArray(records)) return [];
  return records.map(safeHfCandidate).filter((x):x is VideoModelCandidate=>x!==null).slice(0,30);
}
