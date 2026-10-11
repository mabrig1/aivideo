import { NextRequest, NextResponse } from 'next/server';
import {
  approveAndContinue,
  createProduction,
  getProduction,
  advanceProduction,
  markPublished,
  type Destination,
  type ProductionRouting,
} from '../../../lib/production-workflow';

function routingFromBody(value: unknown): ProductionRouting | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const routing = value as Partial<ProductionRouting>;
  const modes = new Set([
    'free-only',
    'free-preferred',
    'commercial-safe',
    'best-quality',
  ]);

  if (!routing.mode || !modes.has(routing.mode)) return undefined;

  return {
    mode: routing.mode,
    selectedProviderId:
      typeof routing.selectedProviderId === 'string'
        ? routing.selectedProviderId.slice(0, 80)
        : null,
    requiresHumanApproval: Boolean(routing.requiresHumanApproval),
    warnings: Array.isArray(routing.warnings)
      ? routing.warnings.map((warning) => String(warning).slice(0, 300)).slice(0, 10)
      : [],
    requestedAspectRatio:
      typeof routing.requestedAspectRatio === 'string'
        ? routing.requestedAspectRatio.slice(0, 20)
        : undefined,
    generationAspectRatio:
      typeof routing.generationAspectRatio === 'string'
        ? routing.generationAspectRatio.slice(0, 20)
        : undefined,
    finishingStrategy:
      typeof routing.finishingStrategy === 'string'
        ? routing.finishingStrategy.slice(0, 500)
        : undefined,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body?.brief || !body?.audioName) {
      return NextResponse.json(
        { error: 'brief and audioName are required' },
        { status: 400 },
      );
    }

    const destinations = (body.destinations || [
      'youtube',
      'instagram',
      'facebook',
      'tiktok',
      'website',
    ]) as Destination[];

    return NextResponse.json(
      createProduction({
        title: body.title,
        brief: body.brief,
        template: body.template || 'Auto Director',
        ratio: body.ratio || '16:9',
        audioName: body.audioName,
        referenceCount: Number(body.referenceCount || 0),
        destinations,
        publishMode:
          body.publishMode === 'auto-publish'
            ? 'auto-publish'
            : 'review-first',
        routing: routingFromBody(body.routing),
      }),
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: 'Invalid production request' },
      { status: 400 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    let job;
    if (body.action === 'advance') job = advanceProduction(body.id);
    else if (body.action === 'approve') job = approveAndContinue(body.id);
    else if (body.action === 'published') {
      job = markPublished(body.id, body.urls || {});
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    return job
      ? NextResponse.json(job)
      : NextResponse.json({ error: 'Production not found' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const job = getProduction(id);
  return job
    ? NextResponse.json(job)
    : NextResponse.json({ error: 'Production not found' }, { status: 404 });
}
