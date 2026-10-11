import { NextRequest, NextResponse } from 'next/server';
import {
  KAGGLE_PIPELINES,
  KaggleInputError,
  bridgeAuthorized,
  bridgeReady,
  completeArtifact,
  listArtifacts,
  prepareArtifact,
} from '../../../lib/kaggle-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

function errorResponse(error: unknown) {
  if (error instanceof KaggleInputError) return json({ error: error.message }, 400);
  // Never return provider exceptions, signed URLs or storage credentials to callers.
  console.error('Kaggle bridge operation failed:', error instanceof Error ? error.name : 'unknown');
  return json({ error: 'Kaggle import or storage request failed.' }, 502);
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action');
  if (action !== 'assets') {
    return json({
      pipelines: KAGGLE_PIPELINES,
      bridgeConfigured: bridgeReady(),
      mode: 'manual-kaggle-to-private-R2',
      liveNotebookExecution: false,
      message: 'Open a Kaggle notebook to run it; use the authenticated bridge to import finished files. Temporary Kaggle GPUs are not public app workers.',
    });
  }
  if (!bridgeAuthorized(req.headers.get('authorization'))) {
    return json({ error: 'Owner token required.' }, 401);
  }
  if (!bridgeReady()) return json({ error: 'Import storage is not configured.' }, 503);
  try {
    const pipeline = req.nextUrl.searchParams.get('pipeline') || undefined;
    return json({ assets: await listArtifacts(pipeline) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  if (!bridgeAuthorized(req.headers.get('authorization'))) {
    return json({ error: 'Owner token required.' }, 401);
  }
  if (!bridgeReady()) return json({ error: 'Import storage is not configured.' }, 503);
  const length = Number(req.headers.get('content-length') || '0');
  if (length > 16_384) return json({ error: 'Request payload too large.' }, 413);
  try {
    const body = await req.json() as Record<string, unknown>;
    if (body.action === 'prepare') {
      return json(await prepareArtifact(body), 201);
    }
    if (body.action === 'complete') {
      const asset = await completeArtifact(body);
      return json({
        completed: true, id: asset.id, pipeline: asset.pipeline,
        projectId: asset.projectId, filename: asset.filename,
        sizeBytes: asset.sizeBytes,
      }, 201);
    }
    return json({ error: 'action must be prepare or complete.' }, 400);
  } catch (error) {
    return errorResponse(error);
  }
}
