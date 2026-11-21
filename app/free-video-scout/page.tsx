'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';

type Provider={
 id:string;label:string;access:string;connectedByServerConfig:boolean;
 connectionVerified:boolean;generationReady:boolean;
 monthlyFreeRemaining:number|null;monthlyFreeUnit:string|null;
 purchasedRemaining:number|null;totalRemaining:number|null;
 quotaStatus:string;source:string;explanation:string;
};
type Candidate={id:string;label:string;officialUrl:string;origin:string;access:string;freeCloudCredits:string;apiIntegration:string;note:string};
type Wallet={checkedAt:string;providers:Provider[];rule:string};
type Scout={checkedAt:string;remoteStatus:string;fetchedAt:string|null;candidates:Candidate[];constraints:{note:string}};
export default function FreeVideoScoutPage(){
 const [wallet,setWallet]=useState<Wallet|null>(null);
 const [scout,setScout]=useState<Scout|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const refresh=useCallback(async ()=>{
  setBusy(true);setError('');
  try{
   const results=await Promise.all([
     fetch('/api/free-video-wallet',{cache:'no-store'}),
     fetch('/api/free-video-scout',{cache:'no-store'})
   ]);
   if(results.some(r=>!r.ok))throw new Error('One or more read-only sources are unavailable');
   setWallet(await results[0].json());
   setScout(await results[1].json());
  }catch(exc){setError(exc instanceof Error?exc.message:'Unable to read provider data');}
  finally{setBusy(false);}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 const recommended=scout?.candidates.filter(c=>c.apiIntegration==='review-required')||[];
 return <main style={{maxWidth:960,margin:'2rem auto',padding:'1.25rem',lineHeight:1.6}}>
  <Link href="/">← AI Video home</Link>
  <h1>Free Video Model Scout + Credit Wallet</h1>
  <p>Find potential video-generation models and see verified vs unknown free balances before spending. Discovery never authorizes an API connection, installs code, submits inference, or spends credits.</p>
  <button onClick={()=>void refresh()} disabled={busy}>{busy?'Refreshing…':'Refresh providers and models'}</button>
  {error&&<p role="alert">{error}</p>}
  <section aria-live="polite"><h2>Monthly free credits</h2>
   <p><strong>Unknown is not zero.</strong> A configured API key is not a working model or confirmed free quota. Current balances require an official authenticated provider balance interface.</p>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:12}}>
    {wallet?.providers.map(p=><article key={p.id} style={{border:'1px solid #8888',borderRadius:12,padding:16}}>
      <h3 style={{marginTop:0}}>{p.label}</h3>
      <p>Configuration: <strong>{p.connectedByServerConfig?'Credential/config present (not independently verified)':'Not configured'}</strong></p>
      <p>Monthly free remaining: <strong>{p.monthlyFreeRemaining===null?'Unknown':p.monthlyFreeRemaining+' '+(p.monthlyFreeUnit||'credits')}</strong></p>
      <p>Purchased remaining: <strong>{p.purchasedRemaining===null?'Unknown':p.purchasedRemaining}</strong></p>
      <p>Generation readiness: <strong>{p.generationReady?'Verified':'Unverified'}</strong></p>
      <small>{p.explanation}</small>
     </article>)}
   </div>
   {!wallet&&<p>Loading balance details…</p>}
  </section>
  <section><h2>Video model discovery</h2>
   <p>Public checkpoints are discovery leads, not confirmed free monthly cloud credits. The scheduled repository scout flags changes for human verification and adapter review.</p>
   <p>Catalog refresh: <strong>{scout?.remoteStatus==='ok'?'Public catalog reachable':scout?'Catalog currently unavailable':'Checking…'}</strong>.</p>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:12}}>
    {(scout?.candidates||[]).map(c=><article key={c.id} style={{border:'1px solid #8888',padding:14,borderRadius:12}}>
     <h3 style={{marginTop:0}}>{c.label}</h3>
     <p><strong>{c.access}</strong> · cloud free credits: <strong>unverified</strong></p>
     <small>{c.note}</small>
     <p><a href={c.officialUrl} target="_blank" rel="noopener noreferrer">Official model page</a></p>
     <small>Integration: {c.apiIntegration}</small>
    </article>)}
   </div>
   {recommended.length>0&&<p>Recommended for technical evaluation: {recommended.map(x=>x.label).join(', ')}. Model availability and operating cost must be checked before approval.</p>}
  </section>
  <section><h2>What an automatic connection requires</h2>
   <p>Verified current official API documentation, explicit free quota or locally funded GPU access, permitted commercial-use license, secure server credential, safe adapter, quota detection, and an operator-approved dry run. Until these pass, the scout discovers candidates but will not activate them.</p>
   <p><strong>Do not paste API keys here.</strong> Connect them through your deployment secret manager only after review.</p>
  </section>
 </main>;
}
