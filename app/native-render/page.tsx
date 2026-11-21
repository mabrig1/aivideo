'use client';
import {useState, type FormEvent} from 'react';
import Link from 'next/link';

type FreeScene={id:number;duration:number;image:string;pageUrl:string;author:string;authorUrl:string;downloadAvailable:boolean;};
type JobStatus = {
  id: string;
  state: string;
  renderMode?: 'audio-proof' | 'scene-master' | 'wan-scene-master';
  wanProgress?: {index:number;state:string};
  qc?: {passed:boolean; mode?:string; sceneCount?:number; duration?:number};
  error?: string;
  pexelsCredits?: {videoId:number;author:string;pageUrl:string}[];
};

export default function NativeRenderPage() {
  const [token,setToken]=useState('');
  const [audio,setAudio]=useState<File|null>(null);
  const [clips,setClips]=useState<File[]>([]);
  const [mode,setMode]=useState<'upload'|'pexels'|'wan'>('upload');
  const [stockQuery,setStockQuery]=useState('mountain sunrise');
  const [stockScenes,setStockScenes]=useState<FreeScene[]>([]);
  const [selectedIds,setSelectedIds]=useState<number[]>([]);
  const [stockError,setStockError]=useState('');
  const [searching,setSearching]=useState(false);
  const [wanPrompts,setWanPrompts]=useState('Cinematic sunrise over a Nigerian city, natural moving clouds and people walking.');
  const [wanSeconds,setWanSeconds]=useState('5');
  const [computeApproval,setComputeApproval]=useState(false);
  const parsedPrompts=wanPrompts.split('\n').map(p=>p.trim()).filter(Boolean);
  const validPrompts=parsedPrompts.length>=1&&parsedPrompts.length<=4&&parsedPrompts.every(p=>p.length>=12&&p.length<=1200);
  const [ratio,setRatio]=useState('9:16');
  const [rights,setRights]=useState(false);
  const [job,setJob]=useState<JobStatus|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  async function searchStock() {
    if(!token || searching || stockQuery.trim().length<2) return;
    setSearching(true);setStockError('');setStockScenes([]);setSelectedIds([]);
    try {
      const orientation=ratio==='9:16'?'portrait':ratio==='1:1'?'square':'landscape';
      const url='/api/free-footage?q='+encodeURIComponent(stockQuery)+'&orientation='+orientation;
      const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Free footage search failed');
      setStockScenes(Array.isArray(result.scenes)?result.scenes:[]);
    }catch(exc){setStockError(exc instanceof Error?exc.message:'Free footage search failed');}
    finally{setSearching(false);}
  }
  function toggleFreeScene(id:number){
    setSelectedIds(previous=>previous.includes(id)?previous.filter(x=>x!==id):previous.length<8?[...previous,id]:previous);
  }

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!audio || !rights || !token || (mode==='upload'&&!clips.length) || (mode==='pexels'&&!selectedIds.length) || (mode==='wan'&&(!validPrompts||!computeApproval))) return;
    setError(''); setJob(null); setBusy(true);
    try {
      const body=new FormData();
      body.append('audio',audio);
      body.append('ratio',ratio);
      body.append('rightsConfirmed','yes');
      if(mode==='upload')for (const clip of clips) body.append('clips',clip);
      if(mode==='pexels')body.append('pexelsIds',JSON.stringify(selectedIds));
      if(mode==='wan'){
        body.append('wanPrompts',JSON.stringify(parsedPrompts));
        body.append('wanSeconds',wanSeconds);
        body.append('computeApproval','yes');
      }
      const response=await fetch('/api/render',{method:'POST',
        headers:{Authorization:`Bearer ${token}`},body,cache:'no-store'});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Render upload failed');
      setJob({id:result.id,state:result.state,renderMode:mode==='wan'?'wan-scene-master':'scene-master'});
    } catch(exc) {setError(exc instanceof Error?exc.message:'Render upload failed');}
    finally {setBusy(false);}
  }
  async function refresh() {
    if (!job?.id || busy) return;
    setError(''); setBusy(true);
    try {
      const response=await fetch(`/api/render/${encodeURIComponent(job.id)}`,{
        headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Status check failed');
      setJob(result);
    } catch(exc) {setError(exc instanceof Error?exc.message:'Status check failed');}
    finally {setBusy(false);}
  }
  async function download() {
    if (!job?.id || job.state!=='ready' || busy) return;
    setError(''); setBusy(true);
    try {
      const response=await fetch(`/api/render/${encodeURIComponent(job.id)}/download`,{
        headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      if(!response.ok)throw new Error('Master download failed');
      const blob=await response.blob();
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;
      link.download=`${job.id}-master.mp4`;
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    } catch(exc) {setError(exc instanceof Error?exc.message:'Master download failed');}
    finally {setBusy(false);}
  }
  return <main style={{maxWidth:760,margin:'3rem auto',padding:'1.5rem',lineHeight:1.6}}>
    <Link href="/">← Back to AI Video</Link>
    <h1>Native Video Master Studio</h1>
    <p>Zero-payment route: find licensed moving scenes on Pexels, upload your own footage, or optionally use a separately enabled private Wan GPU. FFmpeg combines real moving clips with your music into H.264/AAC MP4. No paid generation is needed for the Pexels and upload modes.</p>
    <p><strong>Local operator-only preview.</strong> Requires FFmpeg, MongoDB, Redis, shared storage and a render token. Wan mode additionally requires an explicitly enabled, private GPU worker. No paid provider is called and no automatic publishing occurs.</p>
    <form onSubmit={submit}>
      <p><label>Operator render token (kept in this tab only)<br/><input aria-label="Operator render token" required type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} style={{width:'100%'}}/></label></p>
      <p><label>Soundtrack (MP3/WAV/other supported audio)<br/><input required type="file" accept="audio/*,.mp3,.wav" onChange={e=>setAudio(e.target.files?.[0]||null)}/></label></p>
      <fieldset><legend>Video source</legend>
        <label><input type="radio" name="source" checked={mode==='pexels'} onChange={()=>setMode('pexels')}/> Free licensed footage</label>{' '}
        <label><input type="radio" name="source" checked={mode==='upload'} onChange={()=>setMode('upload')}/> Upload existing clips</label>{' '}
        <label><input type="radio" name="source" checked={mode==='wan'} onChange={()=>setMode('wan')}/> Generate private Wan clips (GPU required)</label>
      </fieldset>
      {mode==='pexels'?<div>
        <p>Search for scenes that illustrate your song. Select 1–8 clips in the order you want them to play. This uses Pexels&#39; free API, not a paid video AI model.</p>
        <p><label>Scene search terms<br/><input type="text" value={stockQuery} maxLength={80} onChange={e=>setStockQuery(e.target.value)} placeholder="mountain sunrise" style={{width:'100%'}}/></label></p>
        <button type="button" disabled={searching||!token||stockQuery.trim().length<2} onClick={searchStock}>{searching?'Searching…':'Find free moving footage'}</button>{' '}
        <a href={'https://www.pexels.com/search/videos/'+encodeURIComponent(stockQuery)+'/'} target="_blank" rel="noopener noreferrer">Browse Pexels directly</a>
        {stockError&&<p role="alert">{stockError} You can download clips on Pexels and use the Upload mode instead.</p>}
        <p>Selected: {selectedIds.length}/8. Clips are used in selection order, looping until the song finishes.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12}}>
          {stockScenes.map(scene=><div key={scene.id} style={{border:'1px solid #aaa',borderRadius:8,padding:8}}>
            {scene.image&&<div role="img" aria-label={'Footage thumbnail by '+scene.author} style={{backgroundImage:'url('+scene.image+')',backgroundSize:'cover',backgroundPosition:'center',height:100,borderRadius:6}}/>}
            <p>{scene.duration}s · {scene.author}</p>
            <button type="button" disabled={!scene.downloadAvailable||(!selectedIds.includes(scene.id)&&selectedIds.length>=8)} onClick={()=>toggleFreeScene(scene.id)}>{selectedIds.includes(scene.id)?'✓ Selected (remove)':scene.downloadAvailable?'Add scene':'Download manually'}</button>
            <p><a href={scene.pageUrl} target="_blank" rel="noopener noreferrer">View video &amp; attribution</a></p>
          </div>)}
        </div>
        <p><a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Videos provided by Pexels</a>. Credit each videographer when possible. Do not redistribute stock clips as-is, imply endorsement, or use the service to build an AI training dataset.</p>
      </div>:mode==='upload'?<div>
        <p><label>Video clips (MP4/WebM/MOV/MKV, 1–8 files)<br/><input required type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.webm,.mov,.mkv" multiple onChange={e=>setClips(Array.from(e.target.files||[]))}/></label></p>
        <p>{clips.length} clips selected. Clips repeat in order until the soundtrack ends. Maximum song length: 10 minutes.</p>
      </div>:<div>
        <p><label>Wan scene prompts (one per line, 1–4 scenes, 12–1200 characters each)<br/><textarea required rows={5} value={wanPrompts} onChange={e=>setWanPrompts(e.target.value)} style={{width:'100%'}}/></label></p>
        <p>{parsedPrompts.length} scene prompts. WAN text-to-video does not use an uploaded artist photo, and it does not lip-sync to the song.</p>
        <p><label>Seconds per generated clip (1–8)<br/><select value={wanSeconds} onChange={e=>setWanSeconds(e.target.value)}>
          {[3,5,8].map(x=><option key={x} value={String(x)}>{x} seconds</option>)}
        </select></label></p>
        <p><label><input type="checkbox" checked={computeApproval} onChange={e=>setComputeApproval(e.target.checked)}/> I authorize private GPU computation for these scenes. I understand even self-hosted inference may incur GPU rental costs.</label></p>
      </div>}
      <p><label>Aspect ratio<br/><select value={ratio} onChange={e=>setRatio(e.target.value)}>
        {['9:16','16:9','1:1','4:5','2.39:1'].map(x=><option key={x} value={x}>{x}</option>)}
      </select></label></p>
      <p><label><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/> I own or have permission to use the music, voices and depicted likenesses.</label></p>
      <button type="submit" disabled={busy||!audio||!rights||!token||(mode==='upload'&&(clips.length===0||clips.length>8))||(mode==='pexels'&&selectedIds.length===0)||(mode==='wan'&&(!validPrompts||!computeApproval||!['9:16','16:9','1:1'].includes(ratio)))}>{busy?'Working…':mode==='wan'?'Generate Wan Scenes & Master MP4':mode==='pexels'?'Create Free Footage MP4':'Create Real MP4 Master'}</button>
    </form>
    {job&&<section aria-live="polite"><h2>Render job</h2><p>ID: {job.id}<br/>State: <strong>{job.state}</strong><br/>Mode: {job.renderMode||'checking'}</p>
      {job.wanProgress&&<p>Wan scene {job.wanProgress.index+1}: {job.wanProgress.state}</p>}
      {job.qc&&<p>Quality check: {job.qc.passed?'passed':'failed'} · clips: {job.qc.sceneCount??'unknown'} · duration: {job.qc.duration??'unknown'} seconds</p>}
      {job.error&&<p role="alert">{job.error}</p>}
      {job.pexelsCredits?.length? <div><p>Source credits to retain when sharing your video:</p><ul>{job.pexelsCredits.map(item=><li key={item.videoId}><a href={item.pageUrl} target="_blank" rel="noopener noreferrer">Video by {item.author} on Pexels</a></li>)}</ul></div>:null}
      <button onClick={refresh} disabled={busy}>Refresh status</button>{' '}
      <button onClick={download} disabled={busy||job.state!=='ready'||job.qc?.passed!==true}>Download MP4</button>
    </section>}
    {error&&<p role="alert">{error}</p>}
  </main>;
}
