import {renderAccessStatus} from '../../../../lib/render-access';
import {NextRequest,NextResponse} from 'next/server';
import {jobsCollection} from '../../../../lib/production-runtime';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const denied=renderAccessStatus(req.headers);
 if(denied)return NextResponse.json({error:denied===401?'Operator authorization required.':'Local render proof is disabled or not configured.'},{status:denied});
 try{
  const {id}=await params;
  const job=await (await jobsCollection()).findOne({id},{projection:{_id:0}});
  if(!job)return NextResponse.json({error:'Render job not found'},{status:404});
  return NextResponse.json(job);
 }catch(error){
  return NextResponse.json({error:error instanceof Error?error.message:'Unable to read render job'},{status:500});
 }
}
