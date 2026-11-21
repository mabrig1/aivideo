/** Read-only provider credit checks. Separate Dev API credits from Runway app credits. */
export type CreditRow = {
  id: string; label: string; status: 'verified'|'unknown'|'not-connected'|'blocked';
  balance: number|null; unit: string; scope: string; resetsAt: string|null;
  verifiedAt: string|null; note: string; dashboard: string;
};
type Obj = Record<string,unknown>;

async function safeJson(url:string,headers:Record<string,string>):Promise<Obj>{
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(url,{headers,method:'GET',cache:'no-store',redirect:'error',signal:controller.signal});
    if(!response.ok)throw Error('Balance service returned '+response.status);
    const raw=await response.text();
    if(raw.length>100000)throw Error('Oversized balance response');
    const parsed:unknown=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid provider response');
    return parsed as Obj;
  } finally {clearTimeout(timeout)}
}
const validAmount=(x:unknown):number|null=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
function row(id:string,label:string,scope:string,dashboard:string,unit='credits'):CreditRow{
  return{id,label,status:'not-connected',balance:null,unit,scope,resetsAt:null,verifiedAt:null,note:'No verified read-only balance integration configured',dashboard};
}
export async function readProviderCredits():Promise<CreditRow[]>{
  const runway=row('runway-dev','Runway Developer API','API project (not Runway web app)','https://dev.runwayml.com/');
  const fal=row('fal','fal.ai API','Prepaid API account','https://fal.ai/dashboard');
  const runwayKey=(process.env.RUNWAYML_API_SECRET||process.env.RUNWAY_API_KEY||'').trim();
  const falKey=(process.env.FAL_KEY||'').trim();
  const jobs:Promise<void>[]=[];
  if(runwayKey)jobs.push((async()=>{
    try{
      const data=await safeJson('https://api.dev.runwayml.com/v1/organization',{
        Authorization:'Bearer '+runwayKey,'X-Runway-Version':'2024-11-06'});
      const balance=validAmount(data.creditBalance);
      runway.status=balance===null?'unknown':'verified';
      runway.balance=balance;
      runway.verifiedAt=balance===null?null:new Date().toISOString();
      runway.note=balance===null?'Runway did not return a numeric creditBalance':'Runway Dev API balance; separate from connected Runway app workspace credits';
    }catch{runway.status='unknown';runway.note='Read-only Runway API balance check failed or lacks permission'}
  })());
  if(falKey)jobs.push((async()=>{
    try{
      const data=await safeJson('https://api.fal.ai/v1/account/billing',{Authorization:'Key '+falKey});
      // Billing API versions differ; do not infer account credit from total spend.
      const credits=data.credits;
      const nested=credits&&typeof credits==='object'&&!Array.isArray(credits)?credits as Obj:{};
      const balance=validAmount(nested.balance)??validAmount(data.balance);
      fal.status=balance===null?'unknown':'verified';
      fal.balance=balance;
      fal.unit='USD';
      fal.verifiedAt=balance===null?null:new Date().toISOString();
      fal.note=balance===null?'Billing endpoint available but remaining USD credit field could not be verified':'fal account billing balance (not an unlimited free tier)';
    }catch{fal.status='unknown';fal.note='fal billing read failed, blocked or key lacks billing permission'}
  })());
  await Promise.all(jobs);
  const others=[
    row('runway-app','Runway connected app workspace','Runway app credits, distinct from Dev API','https://app.runwayml.com/'),
    row('openart','OpenArt','Connected account; connector snapshot only','https://openart.ai/'),
    row('higgsfield','Higgsfield','Connected account; connector snapshot only','https://higgsfield.ai/'),
    row('heygen','HeyGen','Connected account; may withhold wallet balance','https://app.heygen.com/'),
    row('invideo','InVideo','Connected account; connector snapshot only','https://ai.invideo.io/'),
    row('google-vids','Google Vids','Subscription entitlement; not Gemini Veo API','https://vids.google.com/','clips'),
    row('gemini-veo','Google Veo API','API billing is separate from Google Vids','https://aistudio.google.com/','USD'),
    row('local-wan','Self-hosted Wan','Model weights may be free, but GPU compute is metered separately','https://huggingface.co/Wan-AI','GPU-hours'),
  ];
  for(const item of others)item.note='Balance not accessible by this web application. Check authenticated provider account or configure an approved, read-only balance bridge; do not assume zero/unlimited.';
  return[runway,fal,...others];
}
