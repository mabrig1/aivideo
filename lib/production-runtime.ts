import {MongoClient,ObjectId} from 'mongodb';
import Redis from 'ioredis';

const mongoUri=process.env.MONGODB_URI||'';
const redisUrl=process.env.REDIS_URL||'';

let mongoPromise:Promise<MongoClient>|undefined;
let redis:Redis|undefined;

export type RenderJobRecord={
 _id?:ObjectId;
 id:string;
 createdAt:string;
 updatedAt:string;
 state:'queued'|'rendering'|'qc'|'ready'|'failed';
 source:{name:string;path:string;size:number;mime:string};
 brief:string;
 ratio:string;
 output?:{path:string;fileName:string;bytes:number;downloadUrl:string};
 qc?:{passed:boolean;duration:number;videoCodec:string;audioCodec:string;checks:string[]};
 error?:string;
 events:{at:string;message:string}[];
};

function requireEnv(){
 if(!mongoUri)throw new Error('MONGODB_URI is not configured');
 if(!redisUrl)throw new Error('REDIS_URL is not configured');
}

export async function jobsCollection(){
 requireEnv();
 mongoPromise??=new MongoClient(mongoUri).connect();
 const client=await mongoPromise;
 return client.db().collection<RenderJobRecord>('render_jobs');
}

export function renderQueue(){
 requireEnv();
 redis??=new Redis(redisUrl,{maxRetriesPerRequest:2});
 return redis;
}

export async function enqueueRender(id:string){
 await renderQueue().lpush('mabrigverse:render',id);
}

export function newId(){return `mv_${Date.now().toString(36)}_${crypto.randomUUID().slice(0,8)}`;}
export function now(){return new Date().toISOString();}
