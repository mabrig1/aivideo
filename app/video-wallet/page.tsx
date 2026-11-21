'use client';
import Link from 'next/link';
import {useState} from 'react';

type Credit={id:string;label:string;status:'verified'|'unknown'|'not-connected'|'blocked';balance:number|null;unit:string;scope:string;resetsAt:string|null;verifiedAt:string|null;note:string;dashboard:string};
type Wallet={checkedAt:string;providers:Credit[];statement:string;autoSpend:boolean};

export default function VideoCreditWallet(){
  const [token,setToken]=useState('');
  const [wallet,setWallet]=useState<Wallet|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  async function refresh(){
    if(busy)return; setBusy(true);setError('');
    try{
      const response=await fetch('/api/video-wallet',{method:'GET',cache:'no-store',headers:{Authorization:'Bearer '+token}});
      const json=await response.json();
      if(!response.ok)throw Error(json.error||'Unable to read wallet');
      setWallet(json);
    }catch(e){setError(e instanceof Error?e.message:'Wallet unavailable')}finally{setBusy(false)}
  }
  return <main style={{maxWidth:1050,margin:'2rem auto',padding:'1rem',lineHeight:1.6}}>
    <Link href="/">← AI Video Studio</Link>
    <h1>Free Video Model Scout & Credit Wallet</h1>
    <p>A read-only dashboard showing <strong>verified remaining provider credit</strong>, separate account scopes and what still needs authorization. Unknown balances are never shown as zero, unlimited or free.</p>
    <p><label>Wallet operator token (stays in this tab)<br/><input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} style={{width:'100%',maxWidth:500}}/></label></p>
    <button disabled={busy||token.length<32} onClick={refresh}>{busy?'Checking…':'Refresh provider balances'}</button>
    {error&&<p role="alert">{error}</p>}
    {wallet&&<>
      <p>Checked: <time>{new Date(wallet.checkedAt).toLocaleString()}</time>. This is a read-only balance check, not a generation or charge.</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(250px,1fr))',gap:16}}>
        {wallet.providers.map(item=><article key={item.id} style={{padding:16,border:'1px solid #64748b',borderRadius:12}}>
          <strong>{item.label}</strong>
          <p style={{fontSize:'1.4rem',margin:'.3rem 0'}}>{item.status==='verified'&&item.balance!==null?item.balance.toLocaleString()+' '+item.unit:'Balance unknown'}</p>
          <small><strong>{item.status}</strong> · {item.scope}</small>
          <p>{item.note}</p>
          {item.verifiedAt&&<small>Verified {new Date(item.verifiedAt).toLocaleString()}</small>}
          <p><a href={item.dashboard} target="_blank" rel="noopener noreferrer">Open provider dashboard</a></p>
        </article>)}
      </div>
      <p>{wallet.statement}</p>
    </>}
    <section>
      <h2>Model scout</h2>
      <p>The safe discovery agent searches official Hugging Face video-model metadata through a scheduled GitHub Action. Candidates are a review queue, <strong>not automatically executable models</strong>. Model weights may be open while hosted GPU compute costs money.</p>
      <p><a href="https://github.com/mabrig1/aivideo/actions/workflows/free-video-model-scout.yml" target="_blank" rel="noopener noreferrer">View scheduled scout runs</a></p>
    </section>
    <p><strong>Spend guard:</strong> no automatic credit purchases, no paid fallback, and no automatic account connections. Only explicitly authorized rendering routes may generate video.</p>
  </main>;
}
