import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('uploader', Path(__file__).parents[1] / 'scripts/kaggle_upload.py')
uploader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uploader)


class UploaderTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.file = self.root / 'test.mp4'
        self.file.write_bytes(b'video')
        self.workdir = patch.object(uploader, 'WORKDIR', self.root)
        self.workdir.start()

    def tearDown(self):
        self.workdir.stop()
        self.directory.cleanup()

    def run_with(self, *args):
        output = io.StringIO()
        with patch('sys.argv', ['upload', '--pipeline', 'cinema', '--file', str(self.file), *args]), contextlib.redirect_stdout(output):
            result = uploader.run()
        return result, output.getvalue()

    def test_dry_run_never_reads_secrets_or_uses_network(self):
        with patch.object(uploader, 'get_secret') as secret, patch.object(uploader.requests, 'request') as request:
            result, output = self.run_with('--dry-run')
            self.assertEqual(result, 0)
            self.assertIn('Preview only', output)
            secret.assert_not_called()
            request.assert_not_called()

    def test_symlink_cannot_escape_working_directory(self):
        with tempfile.TemporaryDirectory() as external:
            outside = Path(external) / 'secret.mp4'
            outside.write_bytes(b'secret')
            link = self.root / 'linked.mp4'
            link.symlink_to(outside)
            with self.assertRaises(ValueError):
                uploader.validate_file(link)

    def test_network_errors_never_print_signed_urls(self):
        error = uploader.requests.ConnectionError('https://r2.example?X-Amz-Signature=secret')
        self.assertNotIn('secret', uploader.safe_error(error))
        self.assertNotIn('https', uploader.safe_error(error))

    def test_api_refuses_redirects(self):
        with patch.object(uploader.requests, 'request', return_value=Mock(status_code=302)) as request:
            with self.assertRaisesRegex(RuntimeError, 'HTTP 302'):
                uploader.api_request('POST', 'https://app.example/api/kaggle', 'test', {})
            self.assertFalse(request.call_args.kwargs['allow_redirects'])

    def test_full_client_flow_preserves_signed_headers_and_receipt(self):
        receipt = {'version': 2, 'id': 'test', 'pipeline': 'cinema', 'projectId': 'test', 'filename': 'test.mp4',
                   'sizeBytes': 5, 'proof': 'proof', 'expiresAt': 100, 'contentType': 'video/mp4',
                   'uploadUrl': 'https://account.r2.cloudflarestorage.com/bucket/object?signature=test',
                   'uploadHeaders': {'Content-Type': 'video/mp4', 'Content-Length': '5', 'If-None-Match': '*'}}
        secrets = lambda name: 'x' * 32 if name == 'AIVIDEO_BRIDGE_TOKEN' else 'https://app.example'
        with patch.object(uploader, 'get_secret', side_effect=secrets), \
             patch.object(uploader, 'api_request', side_effect=[receipt, {'completed': True, 'id': 'test'}]) as api, \
             patch.object(uploader.requests, 'put', return_value=Mock(status_code=200)) as put:
            result, _ = self.run_with('--consent')
            self.assertEqual(result, 0)
            self.assertEqual(put.call_args.kwargs['headers'], receipt['uploadHeaders'])
            self.assertFalse(put.call_args.kwargs['allow_redirects'])
            completion = api.call_args.args[3]
            self.assertEqual(completion['version'], 2)
            self.assertEqual(completion['expiresAt'], 100)


if __name__ == '__main__':
    unittest.main()
