"""Deterministic, rights-cleared synthetic media tests for the native master."""
import subprocess
import tempfile
import unittest
from pathlib import Path

from scene_master import assemble_scene_master, inspect_media


def command(args):
    subprocess.run(args, check=True, capture_output=True, text=True, timeout=120)


class SceneMasterTest(unittest.TestCase):
    def test_real_video_and_soundtrack(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary) / 'job'
            job.mkdir()
            audio = job / 'song.wav'
            scene_one = job / 'scene-one.mp4'
            scene_two = job / 'scene-two.mp4'
            output_dir = job / 'master'
            output_dir.mkdir()
            master = output_dir / 'master.mp4'
            command(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
                     '-f','lavfi','-i','sine=frequency=440:duration=3',
                     '-c:a','pcm_s16le',str(audio)])
            command(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
                     '-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=1',
                     '-an','-c:v','libx264','-pix_fmt','yuv420p',str(scene_one)])
            command(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
                     '-f','lavfi','-i','smptebars=size=320x180:rate=30:duration=1',
                     '-an','-c:v','libx264','-pix_fmt','yuv420p',str(scene_two)])
            report = assemble_scene_master(audio,[scene_one,scene_two],master,output_dir,'16:9')
            self.assertEqual(report['mode'],'scene-master')
            self.assertEqual(report['sceneCount'],2)
            duration, streams = inspect_media(master)
            self.assertTrue(2.9 <= duration <= 3.2, duration)
            self.assertIn('video',streams)
            self.assertIn('audio',streams)
            # Different frames across scenes establish that the master is
            # not a constant black-background audio-video placeholder.
            def frame_md5(position):
                return subprocess.check_output([
                    'ffmpeg','-v','error','-ss',position,'-i',str(master),
                    '-frames:v','1','-f','md5','-',
                ], text=True, timeout=60)
            self.assertNotEqual(frame_md5('0.25'),frame_md5('1.25'))

    def test_rejects_missing_scenes(self):
        with self.assertRaises(ValueError):
            assemble_scene_master('missing.wav',[], 'master.mp4','.','9:16')

    def test_rejects_external_scene_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary) / 'job'
            job.mkdir()
            song = job / 'song.wav'
            external = Path(temporary) / 'other.mp4'
            command(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
                     '-f','lavfi','-i','sine=frequency=440:duration=1',
                     '-c:a','pcm_s16le',str(song)])
            external.write_bytes(b'not a valid video')
            with self.assertRaisesRegex(ValueError,'own job folder'):
                assemble_scene_master(song,[external],job/'master.mp4',job,'16:9')


if __name__=='__main__':
    unittest.main()
