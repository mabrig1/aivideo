import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KAGGLE_PIPELINES,
  KaggleInputError,
  bridgeAuthorized,
  bridgeReady,
  parseArtifactInput,
} from '../lib/kaggle-bridge';

function input(extra: Record<string, unknown> = {}) {
  return {
    pipeline: 'cinema',
    projectId: 'moving-to-the-other-side',
    filename: 'WAN_PADDLERS_01.mp4',
    sizeBytes: 14000,
    consentConfirmed: true,
    ...extra,
  };
}

test('catalogue links to all three owner notebooks', () => {
  assert.deepEqual(KAGGLE_PIPELINES.map((p) => p.id), [
    'cinema', 'voice', 'musetalk',
  ]);
  for (const entry of KAGGLE_PIPELINES) {
    assert.equal(new URL(entry.notebookUrl).hostname, 'www.kaggle.com');
    assert.ok(entry.purpose.length > 30);
  }
});

test('accepts pipeline media files and maps MIME from safe extension', () => {
  const cinema = parseArtifactInput(input());
  assert.equal(cinema.contentType, 'video/mp4');
  const voice = parseArtifactInput(input({
    pipeline: 'voice', filename: 'voice.wav',
  }));
  assert.equal(voice.contentType, 'audio/wav');
  const lip = parseArtifactInput(input({
    pipeline: 'musetalk', filename: 'lip.webm',
  }));
  assert.equal(lip.contentType, 'video/webm');
});

test('rejects file traversal, unrecognized formats and unsupported pipeline formats', () => {
  for (const filename of [
    '../.env', '../../secrets.wav', 'folder/shot.mp4',
    'private\\shot.mp4', '.hidden.mp4', 'test..mp4', 'evil.exe',
  ]) {
    assert.throws(() => parseArtifactInput(input({ filename })), KaggleInputError);
  }
  assert.throws(() => parseArtifactInput(input({
    pipeline: 'voice', filename: 'voice.mp4',
  })), KaggleInputError);
  assert.throws(() => parseArtifactInput(input({
    pipeline: 'invalid',
  })), KaggleInputError);
});

test('rejects missing voice/likeness permission, oversize and invalid project ids', () => {
  for (const changed of [
    { consentConfirmed: false },
    { consentConfirmed: undefined },
    { sizeBytes: 0 },
    { sizeBytes: 1024 * 1024 * 1024 + 1 },
    { sizeBytes: 2.4 },
    { projectId: '../another-user' },
  ]) {
    assert.throws(() => parseArtifactInput(input(changed)), KaggleInputError);
  }
});

test('owner auth fails closed when unset, short or wrong', () => {
  const original = process.env.KAGGLE_BRIDGE_TOKEN;
  try {
    delete process.env.KAGGLE_BRIDGE_TOKEN;
    assert.equal(bridgeAuthorized('Bearer anything'), false);
    process.env.KAGGLE_BRIDGE_TOKEN = 'weak';
    assert.equal(bridgeAuthorized('Bearer weak'), false);
    process.env.KAGGLE_BRIDGE_TOKEN = 'test-only-bridge-token-123456789012345';
    assert.equal(bridgeAuthorized(null), false);
    assert.equal(bridgeAuthorized('Bearer wrong-token'), false);
    assert.equal(bridgeAuthorized('Bearer test-only-bridge-token-123456789012345'), true);
  } finally {
    if (original === undefined) delete process.env.KAGGLE_BRIDGE_TOKEN;
    else process.env.KAGGLE_BRIDGE_TOKEN = original;
  }
});

test('bridge readiness requires token and private storage', () => {
  const vars = [
    'KAGGLE_BRIDGE_TOKEN', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY', 'R2_BUCKET',
  ];
  const original = Object.fromEntries(vars.map((key) => [key, process.env[key]]));
  try {
    for (const key of vars) delete process.env[key];
    assert.equal(bridgeReady(), false);
    process.env.KAGGLE_BRIDGE_TOKEN = 'test-only-bridge-token-123456789012345';
    assert.equal(bridgeReady(), false);
    process.env.R2_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET = 'media';
    assert.equal(bridgeReady(), true);
  } finally {
    for (const key of vars) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
