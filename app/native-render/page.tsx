'use client';
import {useState, type FormEvent} from 'react';

type JobStatus = {
  id: string;
  state: string;
  renderMode?: 'audio-proof' | 'scene-master';
  qc?: {passed:boolean; mode?:string; sceneCount?:number; duration?:number};
  error?: string;
};

export default function NativeRenderPage() {
  const [token,setToken]=useState('');
  const [audio,setAudio]=useState<File|null>(null);
  const [clips,setClips]=useState<File[]>([]);
  const [ratio,setRatio]=useState('9:16');
  const [rights,setRights]=useState(false);
  const [job,setJob]=useState<JobStatus|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!audio || !clips.length || !rights || !token) return;
    setError(''); setJob(null); setBusy(true);
    try {
      const body=new FormData();
      body.append('audio',audio);
      body.append('ratio',ratio);
      body.append('rightsConfirmed','yes');
      for (const clip of clips) body.append('clips',clip);
      const response=await fetch('/api/render',{method:'POST',
        headers:{Authorization:`Bearer ${token}`},body,cache:'no-store'});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Render upload failed');
      setJob({id:result.id,state:result.state,renderMode:'scene-master'});
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
    <a href="/">← Back to AI Video</a>
    <h1>Native Video Master Studio</h1>
    <p>Combine up to eight genuine video clips with your soundtrack into a downloadable H.264/AAC MP4. The FFmpeg worker loops your visual sequence to cover the song duration; it does not invent frames, create lip-sync, or charge a video provider.</p>
    <p><strong>Local operator-only preview.</strong> Requires the separate FFmpeg render worker, local shared storage, MongoDB, Redis and an enabled operator token. It is unavailable on Cloudflare by default.</p>
    <form onSubmit={submit}>
      <p><label>Operator render token (kept in this tab only)<br/><input aria-label="Operator render token" required type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} style={{width:'100%'}}/></label></p>
      <p><label>Soundtrack (MP3/WAV/other supported audio)<br/><input required type="file" accept="audio/*,.mp3,.wav" onChange={e=>setAudio(e.target.files?.[0]||null)}/></label></p>
      <p><label>Video clips (MP4/WebM/MOV/MKV, 1–8 files)<br/><input required type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.webm,.mov,.mkv" multiple onChange={e=>setClips(Array.from(e.target.files||[]))}/></label></p>
      <p>{clips.length} clips selected. Clips play in the order selected, then repeat until the soundtrack ends. Maximum song length: 10 minutes.</p>
      <p><label>Aspect ratio<br/><select value={ratio} onChange={e=>setRatio(e.target.value)}>
        {['9:16','16:9','1:1','4:5','2.39:1'].map(x=><option key={x} value={x}>{x}</option>)}
      </select></label></p>
      <p><label><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/> I own or have permission to use these video clips and the soundtrack.</label></p>
      <button type="submit" disabled={busy||!audio||clips.length===0||clips.length>8||!rights||!token}>{busy?'Working…':'Create Real MP4 Master'}</button>
    </form>
    {job&&<section aria-live="polite"><h2>Render job</h2><p>ID: {job.id}<br/>State: <strong>{job.state}</strong><br/>Mode: {job.renderMode||'checking'}</p>
      {job.qc&&<p>Quality check: {job.qc.passed?'passed':'failed'} · clips: {job.qc.sceneCount??'unknown'} · duration: {job.qc.duration??'unknown'} seconds</p>}
      {job.error&&<p role="alert">{job.error}</p>}
      <button onClick={refresh} disabled={busy}>Refresh status</button>{' '}
      <button onClick={download} disabled={busy||job.state!=='ready'||job.qc?.passed!==true}>Download MP4</button>
    </section>}
    {error&&<p role="alert">{error}</p>}
  </main>;
}
