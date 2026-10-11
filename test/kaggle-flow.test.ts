import test, { beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { S3Client } from '@aws-sdk/client-s3';
import { NextRequest } from 'next/server';
import { prepareArtifact, completeArtifact, listArtifacts, checkBridgeStorage, bridgeAuthorized, bridgeReady } from '../lib/kaggle-bridge';
import { bridgeBuild } from '../lib/kaggle-config';
import { phase1Services } from '../lib/phase1-config';
import { GET, POST } from '../app/api/kaggle/route';

const original = { ...process.env };
const token = 'test-only-secret-with-more-than-32-characters';
const input = { pipeline: 'cinema', projectId: 'test', filename: 'test.mp4', sizeBytes: 42, consentConfirmed: true };
type Command = { constructor: { name: string }; input: Record<string, any> };
let objects: Map<string, Record<string, any>>;
let commands: Command[];
const storageError = (status: number) => Object.assign(new Error('Storage failure'), { $metadata: { httpStatusCode: status } });

beforeEach(() => {
  Object.assign(process.env, { KAGGLE_BRIDGE_TOKEN: token, R2_ENDPOINT: 'https://testaccount.r2.cloudflarestorage.com', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test-bucket' });
  objects = new Map(); commands = [];
  mock.method(S3Client.prototype, 'send', async (command: Command) => {
    commands.push(command);
    const { Key, Body, IfNoneMatch, IfMatch, Prefix, ContinuationToken, MaxKeys } = command.input;
    const object = objects.get(Key);
    switch (command.constructor.name) {
      case 'HeadObjectCommand':
        if (!object) throw storageError(404);
        if (IfMatch && object.ETag !== IfMatch) throw storageError(412);
        return object;
      case 'GetObjectCommand':
        if (!object) throw storageError(404);
        return { Body: { transformToString: async () => object.Body } };
      case 'PutObjectCommand':
        if (IfNoneMatch === '*' && object) throw storageError(412);
        objects.set(Key, { Body }); return {};
      case 'DeleteObjectCommand': objects.delete(Key); return {};
      case 'ListObjectsV2Command': {
        const keys = [...objects.keys()].filter(k => k.startsWith(Prefix)).sort();
        const offset = Number(ContinuationToken || 0);
        const more = offset + MaxKeys < keys.length;
        return { Contents: keys.slice(offset, offset + MaxKeys).map(Key => ({ Key })), IsTruncated: more, NextContinuationToken: more ? String(offset + MaxKeys) : undefined };
      }
      default: throw new Error(`Unexpected storage command: ${command.constructor.name}`);
    }
  });
});
afterEach(() => {
  mock.restoreAll();
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
});

function upload(receipt: { key: string; sizeBytes: number; contentType: string }, extra = {}) {
  objects.set(receipt.key, { ContentLength: receipt.sizeBytes, ContentType: receipt.contentType, ETag: '"test-etag"', ...extra });
}
function request(body: unknown, authorized = true) {
  return new NextRequest('https://app.example/api/kaggle', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}

test('prepare signs length, MIME and create-only upload condition with a bounded receipt', async () => {
  const receipt = await prepareArtifact(input);
  const url = new URL(receipt.uploadUrl);
  const signed = url.searchParams.get('X-Amz-SignedHeaders')!.split(';');
  for (const header of ['content-length', 'content-type', 'if-none-match']) assert.ok(signed.includes(header), header);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(receipt.uploadHeaders['If-None-Match'], '*');
  assert.equal(receipt.uploadHeaders['Content-Length'], '42');
  assert.ok(receipt.expiresAt <= Math.floor(Date.now() / 1000) + 1800);
  assert.equal(commands.length, 0, 'prepare must not access R2');
});

test('complete, retry, list and signed download retain one stable manifest', async () => {
  const receipt = await prepareArtifact(input); upload(receipt);
  const asset = await completeArtifact(receipt);
  assert.deepEqual(await completeArtifact(receipt), asset);
  assert.equal(commands.filter(c => c.constructor.name === 'PutObjectCommand').length, 1);
  const page = await listArtifacts('cinema');
  assert.equal(page.assets[0].id, asset.id);
  assert.equal(new URL(page.assets[0].downloadUrl).searchParams.get('X-Amz-Expires'), '600');
  assert.equal(page.nextCursor, null);
});

test('modified, expired and legacy receipts fail before touching storage', async () => {
  const receipt = await prepareArtifact(input);
  for (const change of [{ sizeBytes: 99 }, { projectId: 'other' }, { expiresAt: receipt.expiresAt + 1 }, { expiresAt: 1 }, { proof: 'wrong' }, { version: 1 }]) {
    await assert.rejects(completeArtifact({ ...receipt, ...change }));
  }
  assert.equal(commands.length, 0);
});

test('mismatched uploaded objects are removed and never indexed', async () => {
  for (const change of [{ ContentLength: 1000 }, { ContentType: 'text/html' }]) {
    const receipt = await prepareArtifact(input); upload(receipt, change);
    await assert.rejects(completeArtifact(receipt), /removed/);
    assert.equal(objects.has(receipt.key), false);
  }
  assert.equal(commands.filter(c => c.constructor.name === 'PutObjectCommand').length, 0);
});

test('missing uploads do not produce a manifest', async () => {
  await assert.rejects(completeArtifact(await prepareArtifact(input)));
  assert.equal(objects.size, 0);
});

test('pagination reaches artifacts beyond the old first-100-key limit', async () => {
  for (let i = 0; i < 105; i++) {
    const receipt = await prepareArtifact(input); upload(receipt); await completeArtifact(receipt);
  }
  const seen = new Set<string>(); let cursor: string | undefined;
  do {
    const page = await listArtifacts('cinema', cursor);
    page.assets.forEach(a => seen.add(a.id)); cursor = page.nextCursor || undefined;
  } while (cursor);
  assert.equal(seen.size, 105);
});

test('listing skips malformed, deleted and replaced files without hiding access failures', async () => {
  const receipt = await prepareArtifact(input); upload(receipt); await completeArtifact(receipt);
  objects.set('kaggle/manifests/cinema/bad.json', { Body: '{}' });
  objects.set('kaggle/manifests/cinema/broken.json', { Body: '{' });
  objects.get(receipt.key)!.ETag = '"replaced"';
  assert.equal((await listArtifacts()).assets.length, 0);
  objects.delete(receipt.key);
  assert.equal((await listArtifacts()).assets.length, 0);
  mock.method(S3Client.prototype, 'send', async () => { throw storageError(403); });
  await assert.rejects(listArtifacts());
});

test('configuration, authorization and health agree on token and endpoint validation', () => {
  process.env.KAGGLE_BRIDGE_TOKEN = 'x'.repeat(31);
  assert.equal(bridgeReady(), false);
  assert.equal(bridgeAuthorized(`Bearer ${process.env.KAGGLE_BRIDGE_TOKEN}`), false);
  assert.equal(phase1Services().find(s => s.key === 'kaggle-import')!.configured, false);
  process.env.KAGGLE_BRIDGE_TOKEN = token;
  for (const endpoint of ['http://test.r2.cloudflarestorage.com', 'https://evil.example', 'https://user:password@test.r2.cloudflarestorage.com', 'https://test.r2.cloudflarestorage.com?x=1']) {
    process.env.R2_ENDPOINT = endpoint; assert.equal(bridgeReady(), false);
  }
});

test('catalog exposes build identity without credentials, and diagnostics require authentication', async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = 'a'.repeat(40);
  const catalog = await GET(new NextRequest('https://app.example/api/kaggle'));
  const body = await catalog.json();
  assert.equal(body.build.commit, 'a'.repeat(40));
  assert.equal(body.liveNotebookExecution, false);
  assert.ok(!JSON.stringify(body).includes(token));
  assert.equal((await GET(new NextRequest('https://app.example/api/kaggle?action=diagnostics'))).status, 401);
  assert.equal((await GET(new NextRequest('https://app.example/api/kaggle?action=assets'))).status, 401);
  assert.equal((await POST(request({ action: 'prepare', ...input }, false))).status, 401);
  assert.equal(commands.length, 0);
  const diagnostic = await checkBridgeStorage();
  assert.equal(diagnostic.storageListVerified, true);
  assert.equal(diagnostic.writeVerified, false);
  assert.equal(diagnostic.bucketPrivacyVerified, false);
});

test('HTTP flow prepares, completes and lists using the v2 contract', async () => {
  const prepared = await POST(request({ action: 'prepare', ...input }));
  assert.equal(prepared.status, 201);
  const receipt = await prepared.json(); upload(receipt);
  const complete = await POST(request({ ...receipt, action: 'complete' }));
  assert.equal(complete.status, 201);
  assert.equal((await complete.json()).completed, true);
  const listed = await GET(new NextRequest('https://app.example/api/kaggle?action=assets', { headers: { Authorization: `Bearer ${token}` } }));
  assert.equal((await listed.json()).assets.length, 1);
});

test('HTTP parser rejects oversized bodies without Content-Length and malformed JSON', async () => {
  assert.equal((await POST(request({ padding: 'x'.repeat(17000) }))).status, 413);
  for (const body of ['{', 'null', '[]']) {
    const r = new NextRequest('https://app.example/api/kaggle', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
    assert.equal((await POST(r)).status, 400);
  }
  assert.equal(commands.length, 0);
});

test('provider errors are sanitized in HTTP responses', async () => {
  mock.method(S3Client.prototype, 'send', async () => { throw new Error(`sensitive-url?token=${token}`); });
  const response = await GET(new NextRequest('https://app.example/api/kaggle?action=assets', { headers: { Authorization: `Bearer ${token}` } }));
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes(token));
});

test('unidentified builds cannot instruct users to run a mutable uploader', () => {
  delete process.env.VERCEL_GIT_COMMIT_SHA; delete process.env.GITHUB_SHA;
  assert.equal(bridgeBuild().uploaderUrl, null);
});


test('concurrent completion retries converge on one manifest', async () => {
  const receipt = await prepareArtifact(input); upload(receipt);
  const results = await Promise.all([completeArtifact(receipt), completeArtifact(receipt)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal([...objects.keys()].filter(k => k.startsWith('kaggle/manifests/')).length, 1);
});
