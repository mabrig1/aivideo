import { NextRequest, NextResponse } from 'next/server';
import { persistProviderOutputs } from '../../../lib/video-execution/artifacts';
import {
  executeWithFallback,
  getExecutionStatus,
} from '../../../lib/video-execution/orchestrator';
import type {
  ExecutionProviderId,
  VideoExecutionInput,
} from '../../../lib/video-execution/types';

const PROVIDERS = new Set<ExecutionProviderId>([
  'local-wan',
  'gemini-veo',
  'runway',
]);

function enabled() {
  const value = process.env.VIDEO_EXECUTION_ENABLED?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

function authorized(req: NextRequest) {
  const configured = process.env.VIDEO_EXECUTION_TOKEN?.trim();
  if (!configured) return false;

  const bearer = req.headers.get('authorization');
  const explicit = req.headers.get('x-video-execution-token');
  return bearer === `Bearer ${configured}` || explicit === configured;
}

function deny() {
  return NextResponse.json(
    {
      error:
        'Video execution is disabled or unauthorized. Routing remains available without spending provider credits.',
    },
    { status: 403 },
  );
}

function providerFrom(value: unknown): ExecutionProviderId | null {
  return typeof value === 'string' &&
    PROVIDERS.has(value as ExecutionProviderId)
    ? (value as ExecutionProviderId)
    : null;
}

export async function POST(req: NextRequest) {
  if (!enabled() || !authorized(req)) return deny();

  try {
    const body = (await req.json()) as { input?: VideoExecutionInput };
    if (!body?.input) {
      return NextResponse.json({ error: 'input is required' }, { status: 400 });
    }

    const result = await executeWithFallback(body.input);
    return NextResponse.json(result, {
      status: result.submission ? 202 : 503,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Invalid video execution request',
      },
      { status: 400 },
    );
  }
}

export async function PUT(req: NextRequest) {
  if (!enabled() || !authorized(req)) return deny();

  try {
    const body = (await req.json()) as {
      missionId?: string;
      providerId?: string;
      providerJobId?: string;
    };
    const providerId = providerFrom(body.providerId);
    const missionId = body.missionId?.trim();
    const providerJobId = body.providerJobId?.trim();

    if (!missionId || !providerId || !providerJobId) {
      return NextResponse.json(
        { error: 'missionId, providerId and providerJobId are required' },
        { status: 400 },
      );
    }

    const status = await getExecutionStatus(providerId, providerJobId);
    if (status.status !== 'succeeded') {
      return NextResponse.json(
        {
          error: 'Provider job is not ready for persistence.',
          providerStatus: status.status,
        },
        { status: 409 },
      );
    }

    const persisted = await persistProviderOutputs(missionId, status);
    return NextResponse.json(persisted, {
      status: persisted.artifacts.length ? 200 : 502,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Artifact persistence failed',
      },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest) {
  if (!enabled() || !authorized(req)) return deny();

  const providerId = providerFrom(
    req.nextUrl.searchParams.get('providerId'),
  );
  const providerJobId = req.nextUrl.searchParams.get('providerJobId');

  if (!providerId || !providerJobId) {
    return NextResponse.json(
      { error: 'providerId and providerJobId are required' },
      { status: 400 },
    );
  }

  try {
    const status = await getExecutionStatus(providerId, providerJobId);
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Provider status failed',
      },
      { status: 502 },
    );
  }
}
