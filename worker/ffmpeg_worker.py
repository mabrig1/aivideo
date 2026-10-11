import json,os,subprocess,threading,time
from pathlib import Path
from fastapi import FastAPI
from pymongo import MongoClient
from redis import Redis

app=FastAPI(title='Mabrig Verse Render Worker',version='0.2.0')
MONGO=os.getenv('MONGODB_URI','')
REDIS=os.getenv('REDIS_URL','')
MEDIA_ROOT=os.getenv('LOCAL_MEDIA_ROOT','/data/media')
QUEUE='mabrigverse:render'

mongo=MongoClient(MONGO) if MONGO else None
redis=Redis.from_url(REDIS,decode_responses=True) if REDIS else None
jobs=mongo.get_default_database()['render_jobs'] if mongo else None

def event(job_id,message):
    at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    jobs.update_one({'id':job_id},{'$set':{'updatedAt':at},'$push':{'events':{'at':at,'message':message}}})

def probe(path):
    raw=subprocess.check_output([
        'ffprobe','-v','error','-show_entries','format=duration:stream=codec_type,codec_name',
        '-of','json',str(path)
    ],text=True)
    data=json.loads(raw)
    streams=data.get('streams',[])
    video=next((s for s in streams if s.get('codec_type')=='video'),{})
    audio=next((s for s in streams if s.get('codec_type')=='audio'),{})
    duration=float(data.get('format',{}).get('duration') or 0)
    checks=[]
    if duration>0: checks.append('duration>0')
    if video.get('codec_name')=='h264': checks.append('video=h264')
    if audio.get('codec_name')=='aac': checks.append('audio=aac')
    passed=len(checks)==3
    return {'passed':passed,'duration':round(duration,3),'videoCodec':video.get('codec_name',''),'audioCodec':audio.get('codec_name',''),'checks':checks}

def render(job_id):
    job=jobs.find_one({'id':job_id})
    if not job:
        return
    source=Path(job['source']['path'])
    outdir=Path(MEDIA_ROOT)/job_id
    outdir.mkdir(parents=True,exist_ok=True)
    output=outdir/'master.mp4'
    try:
        jobs.update_one({'id':job_id},{'$set':{'state':'rendering'}})
        event(job_id,'FFmpeg worker claimed the Redis job.')
        ratio=job.get('ratio','16:9')
        size={'16:9':'1920x1080','9:16':'1080x1920','1:1':'1080x1080','4:5':'1080x1350','2.39:1':'1912x800'}[ratio]
        cmd=[
            'ffmpeg','-y','-f','lavfi','-i',f'color=c=black:s={size}:r=30',
            '-i',str(source),'-shortest','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p',
            '-c:a','aac','-b:a','192k','-movflags','+faststart',str(output)
        ]
        subprocess.run(cmd,timeout=900,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True)
        jobs.update_one({'id':job_id},{'$set':{'state':'qc'}})
        event(job_id,'Render completed; ffprobe QC started.')
        qc=probe(output)
        if not qc['passed']:
            raise RuntimeError('QC failed: '+','.join(qc['checks']))
        stat=output.stat()
        jobs.update_one({'id':job_id},{'$set':{
            'state':'ready','qc':qc,
            'output':{'path':str(output),'fileName':f'{job_id}-master.mp4','bytes':stat.st_size,'downloadUrl':f'/api/render/{job_id}/download'}
        }})
        event(job_id,'QC passed. Downloadable master is ready.')
    except Exception as exc:
        jobs.update_one({'id':job_id},{'$set':{'state':'failed','error':str(exc)}})
        event(job_id,f'Render failed: {exc}')

def consume():
    if not redis or jobs is None:
        return
    while True:
        try:
            item=redis.brpop(QUEUE,timeout=5)
            if item:
                render(item[1])
        except Exception as exc:
            print(f'queue error: {exc}',flush=True)
            time.sleep(2)

@app.on_event('startup')
def startup():
    threading.Thread(target=consume,daemon=True).start()

@app.get('/health')
def health():
    try:
        ffmpeg=subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0]
    except Exception:
        ffmpeg='unavailable'
    mongo_ok=False
    redis_ok=False
    try:
        if mongo: mongo.admin.command('ping'); mongo_ok=True
    except Exception: pass
    try:
        if redis: redis.ping(); redis_ok=True
    except Exception: pass
    return {'ok':ffmpeg!='unavailable' and mongo_ok and redis_ok,'ffmpeg':ffmpeg,'mongo':mongo_ok,'redis':redis_ok,'queue':QUEUE}

if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='0.0.0.0',port=8080)
