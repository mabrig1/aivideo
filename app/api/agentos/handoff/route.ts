import {NextRequest,NextResponse} from 'next/server';
import {handoffEnabled,handoffAuthorized,parseHandoff,acceptHandoff,readHandoff} from '../../../../lib/agentos-handoff';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};

function reject():NextResponse {
  return NextResponse.json({error:'AgentOS intake disabled or unauthorized'},{status:403,headers});
}
export async function POST(req:NextRequest) {
  if(!handoffEnabled()||!handoffAuthorized(req.headers.get('authorization')))return reject();
  if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({error:'JSON body required'},{status:415,headers});
  }
  if(Number(req.headers.get('content-length')||0)>10000) {
    return NextResponse.json({error:'Handoff payload exceeds limit'},{status:413,headers});
  }
  try {
    const raw=await req.text();
    if(Buffer.byteLength(raw,'utf8')>10000)return NextResponse.json({error:'Handoff payload exceeds limit'},{status:413,headers});
    const input=parseHandoff(JSON.parse(raw));
    if(!input)return NextResponse.json({error:'Invalid script handoff'},{status:400,headers});
    try {
      const {record,created}=await acceptHandoff(input);
      return NextResponse.json({id:record.sourceJobId,state:record.state,created,
        receivedAt:record.acceptedAt,executionEnabled:false,renderQueued:false,
        source:'mabrig-agentos'}, {status:created?201:200,headers});
    }catch(error){
      if(error instanceof Error && error.message.startsWith('Handoff conflict:'))
        return NextResponse.json({error:'A different payload already exists for this job ID'},{status:409,headers});
      return NextResponse.json({error:'Handoff storage unavailable'},{status:503,headers});
    }
  }catch {
    return NextResponse.json({error:'Malformed JSON handoff'},{status:400,headers});
  }
}
export async function GET(req:NextRequest) {
  if(!handoffEnabled()||!handoffAuthorized(req.headers.get('authorization')))return reject();
  const id=req.nextUrl.searchParams.get('id')||'';
  if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'Invalid job ID'},{status:400,headers});
  try {
    const record=await readHandoff(id);
    return record
      ? NextResponse.json({id:record.sourceJobId,state:record.state,sourceDraftId:record.sourceDraftId,
          projectId:record.projectId,targetPlatforms:record.targetPlatforms,receivedAt:record.acceptedAt,renderQueued:false},
          {headers})
      : NextResponse.json({error:'Handoff not found'},{status:404,headers});
  }catch {
    return NextResponse.json({error:'Handoff storage unavailable'},{status:503,headers});
  }
}
