import { NextResponse } from 'next/server';
import { VIDEO_PROVIDER_REGISTRY, runtimeStatesFromEnvironment } from '../../../lib/video-router/provider-registry';

export const dynamic = 'force-dynamic';

export async function GET() {
  const states = runtimeStatesFromEnvironment();
  return NextResponse.json({
    checkedAt:new Date().toISOString(),
    providers: VIDEO_PROVIDER_REGISTRY.map(provider => {
      const state = states.find(x => x.providerId === provider.id);
      return {
        id:provider.id,label:provider.label,access:provider.access,
        connectedByServerConfig:Boolean(state?.configured),
        connectionVerified:false,
        generationReady:false,
        monthlyFreeRemaining:null,monthlyFreeUnit:null,resetAt:null,
        purchasedRemaining:null,totalRemaining:null,
        quotaStatus:'unknown',
        source:'No authenticated, official read-only balance adapter verified for this provider',
        explanation: provider.id === 'runway'
          ? 'Runway web-app workspace credits and Runway developer API billing are separate. This server cannot read your connected ChatGPT Runway workspace automatically.'
          : provider.access === 'self-hosted'
            ? 'Self-hosted models have no cloud free-credit allocation. GPU capacity, storage and electricity still cost money.'
            : provider.id === 'google-vids'
              ? 'Google Vids workspace entitlement is not the same as Gemini/Veo API quotas.'
              : 'An API key or configured route does not prove that this provider has free quota or that a balance endpoint exists.',
        providerNotes:provider.notes,
      };
    }),
    rule:'Unknown balances must never be shown as zero or unlimited. Operator-reported or historical screenshots are not verified live credits.',
    liveBridgeStatus:'not-connected',
  },{headers:{'Cache-Control':'private, no-store'}});
}
