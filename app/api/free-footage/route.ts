import { NextRequest, NextResponse } from 'next/server';
import { renderAccessStatus } from '../../../lib/render-access';
import { normalizeFreeSceneQuery, searchFreeScenes } from '../../../lib/free-footage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// This is a focused scene-finder for composing original music videos,
// not a Pexels clone or general-purpose media download service.
export async function GET(req: NextRequest) {
  const denied = renderAccessStatus(req.headers);
  if (denied) {
    return NextResponse.json({error: denied === 401
      ? 'Private operator token required.'
      : 'Local Free Footage Studio is not enabled.'}, {status:denied});
  }
  const q = req.nextUrl.searchParams.get('q') || '';
  const orientation = req.nextUrl.searchParams.get('orientation') || 'landscape';
  let normalized: string;
  try {
    normalized = normalizeFreeSceneQuery(q);
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : 'Invalid search'}, {status:400});
  }
  if (!['landscape','portrait','square'].includes(orientation)) {
    return NextResponse.json({error:'Invalid orientation'}, {status:400});
  }
  if (!process.env.PEXELS_API_KEY?.trim()) {
    return NextResponse.json({
      error:'PEXELS_API_KEY is not configured. Open Pexels, download licensed MP4 clips, and select Upload existing clips.',
      configured:false,
      fallbackUrl:'https://www.pexels.com/search/videos/' + encodeURIComponent(normalized) + '/',
    }, {status:503});
  }
  try {
    const results = await searchFreeScenes(normalized, orientation);
    return NextResponse.json({
      configured:true,
      provider:'Pexels',
      scenes:results,
      attribution:'Videos provided by Pexels. Credit individual videographers when possible.',
      licenseUrl:'https://www.pexels.com/license/',
      note:'Original music videos must add meaningful creative value; never redistribute stock footage alone.',
    }, {headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:'Pexels search failed'}, {status:502});
  }
}
