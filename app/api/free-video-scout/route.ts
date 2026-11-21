import { NextResponse } from 'next/server';
import { CURATED_VIDEO_MODELS, extractVideoCandidates } from '../../../lib/free-video-scout';

export const dynamic = 'force-dynamic';

export async function GET() {
  let remoteStatus: 'ok' | 'unavailable' = 'unavailable';
  let candidates = [...CURATED_VIDEO_MODELS];
  let fetchedAt: string | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch('https://huggingface.co/api/models?search=video&sort=lastModified&direction=-1&limit=100', {
        headers: {'Accept':'application/json'}, signal: controller.signal, next: {revalidate: 21600},
      });
      if (response.ok) {
        const payload: unknown = await response.json();
        const discovered = extractVideoCandidates(payload);
        const seen = new Set(candidates.map(x => x.id));
        for (const item of discovered) if (!seen.has(item.id)) {candidates.push(item); seen.add(item.id);}
        remoteStatus = 'ok'; fetchedAt = new Date().toISOString();
      }
    } finally {clearTimeout(timeout);}
  } catch { /* Keep curated candidates while discovery source is unavailable. */ }
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    source: 'Hugging Face public model catalog + curated official checkpoint pages',
    remoteStatus, fetchedAt, candidates,
    constraints: {
      automaticConnectionsEnabled:false,
      automaticBillingEnabled:false,
      monthlyCreditsVerified:false,
      note:'Public model pages are discovery candidates only. Model weights are not proof of a free hosted API, monthly credits, licensed commercial use or server compatibility.',
    },
  }, {headers:{'Cache-Control':'private, no-store'}});
}
