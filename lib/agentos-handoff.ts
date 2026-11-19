import {createHash, timingSafeEqual} from 'node:crypto';
import {MongoClient} from 'mongodb';

/**
 * Durable, inert intake of AgentOS scripts. There is NO dispatch to provider, queue,
 * model, render, or publishing API in this module. Enable only after staging verification.
 */
export type ScriptHandoff = {
  sourceJobId: string;
  sourceDraftId: string;
  projectId: string;
  brief: string;
  script: string;
  targetPlatforms: string[];
};
export type IntakeRecord = ScriptHandoff & {
  payloadHash: string;
  state: 'awaiting-review';
  acceptedAt: string;
  source: 'mabrig-agentos';
};
const platforms = new Set(['youtube','tiktok','facebook','instagram','linkedin']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let clientPromise:Promise<MongoClient>|null=null;

type HandoffSettings={AGENTOS_HANDOFF_ENABLED?:string;AGENTOS_HANDOFF_TOKEN?:string;MONGODB_URI?:string};
export function handoffEnabled(env:HandoffSettings=process.env):boolean {
  return env.AGENTOS_HANDOFF_ENABLED==='true' &&
    Boolean(env.AGENTOS_HANDOFF_TOKEN && env.AGENTOS_HANDOFF_TOKEN.length>=32 && env.MONGODB_URI);
}
export function handoffAuthorized(header:string|null,env:HandoffSettings=process.env):boolean {
  if(!handoffEnabled(env))return false;
  const secret=Buffer.from('Bearer '+env.AGENTOS_HANDOFF_TOKEN);
  const supplied=Buffer.from(header||'');
  return secret.length===supplied.length && timingSafeEqual(secret,supplied);
}
export function parseHandoff(value:unknown):ScriptHandoff|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const a=value as Partial<ScriptHandoff>;
  if(typeof a.sourceJobId!=='string'||!uuid.test(a.sourceJobId))return null;
  if(typeof a.sourceDraftId!=='string'||!uuid.test(a.sourceDraftId))return null;
  if(typeof a.projectId!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(a.projectId))return null;
  if(typeof a.brief!=='string'||a.brief.trim().length<5||a.brief.length>2000)return null;
  if(typeof a.script!=='string'||a.script.trim().length<20||a.script.length>6000)return null;
  if(!Array.isArray(a.targetPlatforms)||a.targetPlatforms.length<1||a.targetPlatforms.length>5||
     !a.targetPlatforms.every(p=>typeof p==='string'&&platforms.has(p))||
     new Set(a.targetPlatforms).size!==a.targetPlatforms.length)return null;
  return {sourceJobId:a.sourceJobId,sourceDraftId:a.sourceDraftId,projectId:a.projectId,
    brief:a.brief.trim(),script:a.script.trim(),targetPlatforms:a.targetPlatforms};
}
export function handoffHash(a:ScriptHandoff):string {
  return createHash('sha256').update(JSON.stringify(a)).digest('hex');
}
async function collection() {
  const uri=process.env.MONGODB_URI;
  if(!uri)throw new Error('Storage not configured');
  clientPromise??=new MongoClient(uri,{serverSelectionTimeoutMS:4000}).connect();
  let client:MongoClient;
  try{client=await clientPromise;}catch(error){clientPromise=null;throw error;}
  const col=client.db().collection<IntakeRecord>('agentos_script_intake');
  await col.createIndex({sourceJobId:1},{unique:true});
  return col;
}
/** Returns an existing record on exact replay; rejects changed data under the same key. */
export async function acceptHandoff(input:ScriptHandoff):Promise<{record:IntakeRecord;created:boolean}> {
  const col=await collection(), payloadHash=handoffHash(input);
  const candidate:IntakeRecord={...input,payloadHash,state:'awaiting-review',source:'mabrig-agentos',acceptedAt:new Date().toISOString()};
  let existed=await col.findOne({sourceJobId:input.sourceJobId});
  if(!existed) {
    try {
      await col.insertOne(candidate);
      return {record:candidate,created:true};
    } catch(error) {
      // A concurrent exact replay may race the unique index. Re-read and compare.
      if(!(error && typeof error==='object' && 'code' in error && error.code===11000))throw error;
      existed=await col.findOne({sourceJobId:input.sourceJobId});
    }
  }
  if(!existed || existed.payloadHash!==payloadHash)throw new Error('Handoff conflict: same job ID has different content');
  return {record:existed,created:false};
}
export async function readHandoff(jobId:string):Promise<IntakeRecord|null> {
  if(!uuid.test(jobId))return null;
  return collection().then(col=>col.findOne({sourceJobId:jobId}));
}
