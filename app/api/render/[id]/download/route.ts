import {renderAccessStatus} from '../../../../../lib/render-access';
import {NextRequest,NextResponse} from 'next/server';
import {readFile} from 'node:fs/promises';
import {jobsCollection} from '../../../../../lib/production-runtime';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const denied=renderAccessStatus(req.headers);
 if(denied)return NextResponse.json({error:denied===401?'Operator authorization required.':'Local render proof is disabled or not configured.'},{status:denied});
 try{
  const {id}=await params;
  const job=await (await jobsCollection()).findOne({id});
  if(!job)return NextResponse.json({error:'Render job not found'},{status:404});
  if(job.state!=='ready'||!job.output?.path)return NextResponse.json({error:'Master is not ready',state:job.state},{status:409});
  const bytes=await readFile(job.output.path);
  return new NextResponse(bytes,{status:200,headers:{'Content-Type':'video/mp4','Content-Length':String(bytes.byteLength),'Content-Disposition':`attachment; filename="${job.output.fileName}"`,'Cache-Control':'private, no-store'}});
 }catch(error){
  return NextResponse.json({error:error instanceof Error?error.message:'Unable to download master'},{status:500});
 }
}
