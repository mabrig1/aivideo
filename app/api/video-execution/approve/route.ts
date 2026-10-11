import { NextRequest, NextResponse } from 'next/server';
import { createExecutionApproval } from '../../../../lib/video-execution/approval';
import type { ExecutionProviderId } from '../../../../lib/video-execution/types';

const METERED = new Set<ExecutionProviderId>(['gemini-veo', 'runway']);

function executionEnabled() {
  const value = process.env.VIDEO_EXECUTION_ENABLED?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

function authorized(req: NextRequest) {
  const configured = process.env.VIDEO_APPROVAL_TOKEN?.trim();
  if (!configured) return false;
  const bearer = req.headers.get('authorization');
  const explicit = req.headers.get('x-video-approval-token');
  return bearer === `Bearer ${configured}` || explicit === configured;
}

export async function POST(req: NextRequest) {
  if (!executionEnabled() || !authorized(req)) {
    return NextResponse.json(
      { error: 'Video execution approval is disabled or unauthorized.' },
      { status: 403 },
    );
  }

  try {
    const body = (await req.json()) as {
      missionId?: string;
      providerIds?: ExecutionProviderId[];
      ttlSeconds?: number;
      maxRunwayCredits?: number;
    };

    const providerIds = (body.providerIds || []).filter((providerId) =>
      METERED.has(providerId),
    );

    const approval = await createExecutionApproval({
      missionId: body.missionId || '',
      providerIds,
      ttlSeconds: body.ttlSeconds,
      maxRunwayCredits: body.maxRunwayCredits,
    });

    return NextResponse.json({
      approvalToken: approval.token,
      approval: approval.payload,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Approval request is invalid.',
      },
      { status: 400 },
    );
  }
}
