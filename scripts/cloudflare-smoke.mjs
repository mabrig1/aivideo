import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Exercise the built Worker, not next dev: adapter failures can pass next build.
// All bindings are local; this check never needs deployment credentials.
const port = 8791;
const publishedUrl = process.env.CLOUDFLARE_SMOKE_URL;
const origin = publishedUrl ? new URL(publishedUrl).origin : `http://127.0.0.1:${port}`;
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
delete env.CLOUDFLARE_API_TOKEN;
delete env.CLOUDFLARE_ACCOUNT_ID;
const worker = publishedUrl ? undefined : spawn(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js', 'dev', '--local',
  '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '9231',
], { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
let startupError;
worker?.on('error', (error) => { startupError = error; });
for (const stream of worker ? [worker.stdout, worker.stderr] : []) {
  stream.on('data', (data) => { logs = (logs + data.toString()).slice(-12000); });
}

async function request(path, options) {
  return fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(10000) });
}

try {
  let home;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (worker && worker.exitCode !== null) throw new Error(`Wrangler exited with ${worker.exitCode}`);
    try { home = await request('/'); break; } catch { await delay(500); }
  }
  assert.ok(home, 'Worker did not start within 60 seconds');
  assert.equal(home.status, 200, 'Homepage must render in the Worker runtime');
  assert.match(await home.text(), /kaggle-studio/, 'Homepage must include Kaggle Studio');

  const catalogResponse = await request('/api/kaggle');
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.build.version, 2);
  assert.equal(catalog.pipelines.length, 3);
  assert.equal(catalog.liveNotebookExecution, false);
  if (publishedUrl && process.env.GITHUB_SHA) {
    assert.equal(catalog.build.commit, process.env.GITHUB_SHA, 'Published Worker must match this revision');
  }
  for (const action of ['assets', 'diagnostics']) {
    assert.equal((await request(`/api/kaggle?action=${action}`)).status, 401);
  }
  assert.equal((await request('/api/kaggle', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })).status, 401);

  const healthResponse = await request('/api/health');
  assert.ok([200, 503].includes(healthResponse.status));
  const health = await healthResponse.json();
  assert.equal(health.app, 'AI Video');
  assert.equal((await request('/missing-smoke-page')).status, 404);
  console.log('Worker smoke passed: homepage, catalogue, owner authorization, health, and 404.');
  if (publishedUrl) {
    console.log('Bridge configuration:', JSON.stringify(catalog.configuration));
    console.log('Service configuration:', JSON.stringify(health.services.map(({ key, configured }) => ({ key, configured }))));
  }
} catch (error) {
  console.error(logs);
  console.error(error);
  process.exitCode = 1;
} finally {
  if (worker?.pid) {
    try {
      if (process.platform === 'win32') worker.kill();
      else process.kill(-worker.pid, 'SIGTERM');
    } catch { /* Process already exited. */ }
  }
}
