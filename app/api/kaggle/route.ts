import { NextRequest, NextResponse } from 'next/server';
import {
  KAGGLE_PIPELINES,
  KaggleInputError,
  bridgeAuthorized,
  bridgeReady,
  completeArtifact,
  checkBridgeStorage,
  listArtifacts,
  prepareArtifact,
} from '../../../lib/kaggle-bridge';

import { bridgeBuild, bridgeConfiguration } from '../../../lib/kaggle-config';
import { readSmallJson, RequestBodyError } from '../../../lib/request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

function errorResponse(error: unknown) {
  if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
  if (error instanceof KaggleInputError) return json({ error: error.message }, 400);
  // Never return provider exceptions, signed URLs or storage credentials to callers.
  console.error('Kaggle bridge operation failed:', error instanceof Error ? error.name : 'unknown');
  return json({ error: 'Kaggle import or storage request failed.' }, 502);
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action');
  if (!action || action === 'catalog') {
    return json({
      pipelines: KAGGLE_PIPELINES,
      build: bridgeBuild(),
      configuration: bridgeConfiguration(),
      bridgeConfigured: bridgeReady(),
      mode: 'manual-kaggle-to-private-R2',
      liveNotebookExecution: false,
      message: 'Open a Kaggle notebook to run it; use the authenticated bridge to import finished files. Temporary Kaggle GPUs are not public app workers.',
    });
  }
  if (action !== 'assets' && action !== 'diagnostics') return json({ error: 'Unknown action.' }, 400);
  if (!bridgeAuthorized(req.headers.get('authorization'))) {
    return json({ error: 'Owner token required.' }, 401);
  }
  if (!bridgeReady()) return json({ error: 'Import storage is not configured.' }, 503);
  try {
    if (action === 'diagnostics') return json(await checkBridgeStorage());
    const pipeline = req.nextUrl.searchParams.get('pipeline') || undefined;
    return json(await listArtifacts(pipeline, req.nextUrl.searchParams.get('cursor') || undefined));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  if (!bridgeAuthorized(req.headers.get('authorization'))) {
    return json({ error: 'Owner token required.' }, 401);
  }
  if (!bridgeReady()) return json({ error: 'Import storage is not configured.' }, 503);

  try {
    const body = await readSmallJson(req);
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
