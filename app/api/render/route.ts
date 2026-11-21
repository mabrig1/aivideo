import {renderAccessStatus} from '../../../lib/render-access';
import {NextRequest,NextResponse} from 'next/server';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {enqueueRender,jobsCollection,newId,now,type RenderJobRecord} from '../../../lib/production-runtime';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const allowed=new Set(['audio/mpeg','audio/wav','audio/x-wav','audio/flac','audio/mp4','audio/aac','audio/ogg']);

export async function POST(req:NextRequest){
 const denied=renderAccessStatus(req.headers);
 if(denied)return NextResponse.json({error:denied===401?'Operator authorization required.':'Local render proof is disabled or not configured.'},{status:denied});
 try{
  if((process.env.STORAGE_DRIVER||'local')!=='local'){
   return NextResponse.json({error:'This endpoint is enabled only for STORAGE_DRIVER=local. Configure the R2 adapter before switching storage drivers.'},{status:501});
  }
  const form=await req.formData();
  const audio=form.get('audio');
  const brief=String(form.get('brief')||'Create a clean downloadable music master from this uploaded audio.');
  const ratio=String(form.get('ratio')||'16:9');
  if(!(audio instanceof File))return NextResponse.json({error:'audio file is required'},{status:400});
  const sceneUploads=form.getAll('clips');
  if(sceneUploads.length>8)return NextResponse.json({error:'Maximum eight video clips per render'},{status:413});
  if(sceneUploads.length && form.get('rightsConfirmed')!=='yes')return NextResponse.json({error:'Confirm rights to all submitted video clips'},{status:400});
  const videoTypes:Record<string,string>={'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','video/x-matroska':'mkv'};
  let sceneBytes=0;
  for(const clip of sceneUploads){
   if(!(clip instanceof File)||!clip.size||clip.size>120*1024*1024||!videoTypes[clip.type])return NextResponse.json({error:'Each clip must be a nonempty MP4/WebM/MOV/MKV video of 120 MB or less'},{status:415});
   sceneBytes+=clip.size;
  }
  if(sceneBytes+audio.size>400*1024*1024)return NextResponse.json({error:'Combined upload exceeds 400 MB'},{status:413});
  if(audio.size===0)return NextResponse.json({error:'audio file is empty'},{status:400});
  if(audio.size>250*1024*1024)return NextResponse.json({error:'audio file exceeds 250 MB limit for the local proof path'},{status:413});
  if(audio.type&&!allowed.has(audio.type))return NextResponse.json({error:`unsupported audio type: ${audio.type}`},{status:415});

  if(!['16:9','9:16','1:1','4:5','2.39:1'].includes(ratio))return NextResponse.json({error:'Unsupported aspect ratio'},{status:400});
  const id=newId();
  const root=process.env.LOCAL_MEDIA_ROOT||'/tmp/mabrigverse-media';
  const jobDir=path.join(/* turbopackIgnore: true */ root,id);
  await mkdir(jobDir,{recursive:true});
  const safeName=(audio.name||'source-audio').replace(/[^a-zA-Z0-9._-]+/g,'_');
  const sourcePath=path.join(jobDir,'source_'+safeName);
  await writeFile(sourcePath,Buffer.from(await audio.arrayBuffer()));
  const scenes:NonNullable<RenderJobRecord['scenes']>=[];
  for(const [index,item] of sceneUploads.entries()){
   const clip=item as File;
   const scenePath=path.join(jobDir,`clip_${String(index).padStart(2,'0')}.${videoTypes[clip.type]}`);
   await writeFile(scenePath,Buffer.from(await clip.arrayBuffer()));
   scenes.push({name:`clip_${index}`,path:scenePath,size:clip.size,mime:clip.type});
  }
  const stamp=now();
  const job:RenderJobRecord={id,createdAt:stamp,updatedAt:stamp,state:'queued',source:{name:safeName,path:sourcePath,size:audio.size,mime:audio.type||'application/octet-stream'},brief,ratio,scenes,renderMode:scenes.length?'scene-master':'audio-proof',events:[{at:stamp,message:'Audio uploaded to durable local media volume.'},{at:stamp,message:scenes.length?`${scenes.length} genuine video clips queued for mastering.`:'Audio-only proof queued; output will have black visuals.'}]};
  await (await jobsCollection()).insertOne(job);
  await enqueueRender(id);
  return NextResponse.json({id,state:'queued',statusUrl:`/api/render/${id}`,message:scenes.length?'Genuine footage master queued.':'Audio-only placeholder proof queued (black visuals).'},{status:202});
 }catch(error){
  return NextResponse.json({error:error instanceof Error?error.message:'Unable to queue render'},{status:500});
 }
}
