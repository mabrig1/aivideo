"""CI-only deterministic Wan protocol simulator; NEVER a production GPU service."""
import json
import os
import subprocess
import tempfile
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

TOKEN = os.environ.get('GPU_WORKER_TOKEN', '')
jobs = {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, data, status=200):
        raw = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def authorized(self):
        if not TOKEN or self.headers.get('Authorization') != f'Bearer {TOKEN}':
            self.send_json({'error':'Unauthorized'},401)
            return False
        return True

    def do_GET(self):
        if not self.authorized():
            return
        if self.path == '/health':
            return self.send_json({'generationReady':True,'backend':'wan-diffusers',
                                   'mock':True,'detail':'CI synthetic media only'})
        if self.path.startswith('/jobs/'):
            item = jobs.get(self.path.removeprefix('/jobs/'))
            return self.send_json(item if item else {'error':'unknown'},200 if item else 404)
        if self.path.startswith('/outputs/'):
            job_id = self.path.removeprefix('/outputs/').removesuffix('.mp4')
            if not self.path.endswith('.mp4') or job_id not in jobs:
                return self.send_json({'error':'unknown'},404)
            raw = Path(os.environ['MOCK_WAN_VIDEO']).read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'video/mp4')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            return self.wfile.write(raw)
        self.send_json({'error':'not found'},404)

    def do_POST(self):
        if not self.authorized():
            return
        if self.path != '/jobs':
            return self.send_json({'error':'unknown'},404)
        size = int(self.headers.get('Content-Length','0'))
        if size < 2 or size > 10000:
            return self.send_json({'error':'invalid size'},400)
        data = json.loads(self.rfile.read(size))
        if (data.get('engine') != 'wan' or not data.get('project_id')
                or not data.get('brief')):
            return self.send_json({'error':'invalid request'},400)
        job_id = 'wan_' + uuid.uuid4().hex
        jobs[job_id] = {
            'jobId':job_id,'projectId':data['project_id'],
            'status':'succeeded',
            'outputUrls':['https://not-the-worker.invalid/evil.mp4'],
        }
        self.send_json({'accepted':True,'jobId':job_id,'status':'queued'},202)


if __name__ == '__main__':
    with tempfile.TemporaryDirectory() as temp:
        video = Path(temp) / 'mock.mp4'
        subprocess.run([
            'ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
            '-f','lavfi','-i','testsrc2=size=320x180:rate=16:duration=3',
            '-an','-c:v','libx264','-pix_fmt','yuv420p',str(video),
        ],check=True,timeout=60)
        os.environ['MOCK_WAN_VIDEO'] = str(video)
        ThreadingHTTPServer(('127.0.0.1',8091),Handler).serve_forever()
