"""Wan private handoff tests using a simulated GPU worker, not real GPU spend."""
import contextlib
import json
import os
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from wan_bridge import (
    BridgeError, configured_worker, generate_wan_scenes, has_moving_frames,
)


class MockWanHandler(BaseHTTPRequestHandler):
    job_id = 'wan_' + 'a' * 32
    project_id = 'mv_test_abcdef12'
    video = b''
    redirect_output = False
    wrong_project = False
    submitted = 0

    def log_message(self, *args):
        pass

    def respond(self, payload, status=200):
        raw = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def authenticated(self):
        if self.headers.get('Authorization') != 'Bearer ' + 'abc123' * 6:
            self.respond({'error':'unauthorized'}, 401)
            return False
        return True

    def do_POST(self):
        if not self.authenticated():
            return
        if self.path != '/jobs':
            self.respond({'error':'not found'},404)
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))))
        except Exception:
            self.respond({'error':'invalid body'},400)
            return
        if body.get('engine') != 'wan' or body.get('project_id') != self.project_id:
            self.respond({'error':'invalid mission'},400)
            return
        type(self).submitted += 1
        self.respond({'accepted':True, 'jobId':self.job_id},202)

    def do_GET(self):
        if not self.authenticated():
            return
        if self.path == '/health':
            return self.respond({'generationReady':True,'backend':'wan-diffusers'})
        if self.path == '/jobs/' + self.job_id:
            return self.respond({
                'jobId':self.job_id,
                'projectId':'wrong-project' if self.wrong_project else self.project_id,
                'status':'succeeded',
                'outputUrls':['https://evil.invalid/download.mp4'],
            })
        if self.path == '/outputs/' + self.job_id + '.mp4':
            if self.redirect_output:
                self.send_response(302)
                self.send_header('Location','https://evil.invalid/steal')
                self.end_headers()
                return
            self.send_response(200)
            self.send_header('Content-Type','video/mp4')
            self.send_header('Content-Length', str(len(self.video)))
            self.end_headers()
            self.wfile.write(self.video)
            return
        return self.respond({'error':'not found'},404)


class WanBridgeTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.root = Path(self.dir.name)
        self.job = self.root / MockWanHandler.project_id
        self.job.mkdir()
        sample = self.root / 'fixture.mp4'
        subprocess.run([
            'ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
            '-f','lavfi','-i','testsrc2=size=160x90:rate=12:duration=2',
            '-an','-c:v','libx264','-pix_fmt','yuv420p',str(sample),
        ], check=True, capture_output=True, timeout=60)
        MockWanHandler.video = sample.read_bytes()
        MockWanHandler.redirect_output = False
        MockWanHandler.wrong_project = False
        MockWanHandler.submitted = 0
        server = ThreadingHTTPServer(('127.0.0.1',0), MockWanHandler)
        self.addCleanup(server.server_close)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        self.addCleanup(server.shutdown)
        self.env = patch.dict(os.environ, {
            'WAN_BRIDGE_ENABLED':'true',
            'WAN_WORKER_URL':f'http://127.0.0.1:{server.server_port}',
            'GPU_WORKER_TOKEN':'abc123' * 6,
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_authenticated_wan_scene_is_saved_and_has_motion(self):
        states=[]
        result=generate_wan_scenes(
            MockWanHandler.project_id,
            ['City sunrise with moving clouds and a gentle cinematic tracking shot'],
            self.job,'16:9',3,lambda *args:states.append(args))
        self.assertEqual(len(result),1)
        self.assertTrue(result[0].is_file())
        self.assertTrue(has_moving_frames(result[0]))
        self.assertEqual(MockWanHandler.submitted,1)
        self.assertEqual(states[-1][1],'scene-ready')

    def test_redirect_download_denied(self):
        MockWanHandler.redirect_output = True
        with self.assertRaisesRegex(BridgeError,'redirected|failed'):
            generate_wan_scenes(MockWanHandler.project_id,
                ['Motion in a city with a cinematic tracking camera'],self.job,'16:9')
        self.assertFalse((self.job / 'wan_scene_00.mp4').exists())

    def test_project_id_mismatch_denied(self):
        MockWanHandler.wrong_project = True
        with self.assertRaisesRegex(BridgeError,'identity mismatch'):
            generate_wan_scenes(MockWanHandler.project_id,
                ['Motion in a city with a cinematic tracking camera'],self.job,'16:9')

    def test_disabled_and_bad_origins_denied(self):
        with patch.dict(os.environ,{'WAN_BRIDGE_ENABLED':'false'}):
            with self.assertRaisesRegex(BridgeError,'disabled'):
                configured_worker()
        with patch.dict(os.environ,{'WAN_WORKER_URL':'http://example.com'}):
            with self.assertRaisesRegex(BridgeError,'restricted'):
                configured_worker()


if __name__ == '__main__':
    unittest.main()
