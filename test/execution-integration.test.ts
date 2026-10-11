import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionApproval, verifyExecutionApproval } from '../lib/video-execution/approval';
import { executeWithFallback } from '../lib/video-execution/orchestrator';
import { runwayAdapter } from '../lib/video-execution/adapters/runway';
import { renderAccessStatus } from '../lib/render-access';
import type { VideoExecutionInput } from '../lib/video-execution/types';

const original = { ...process.env };
afterEach(() => {
  mock.restoreAll();
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
});
const input = (extra: Partial<VideoExecutionInput> = {}): VideoExecutionInput => ({
  missionId: 'integration-test', prompt: 'Presenter', durationSeconds: 8, aspectRatio: '16:9',
  candidateProviderIds: ['local-musetalk'], audioUrl: 'https://media.example/audio.wav',
  sourceImageUrl: 'https://media.example/presenter.png', ...extra,
});

test('approval verifies mission and caps and rejects signature tampering', async () => {
  process.env.VIDEO_APPROVAL_SECRET = 'integration-test-secret';
  const approval = await createExecutionApproval({missionId:'integration-test',providerIds:['runway'],maxRunwayCredits:20});
  assert.equal((await verifyExecutionApproval(approval.token,input({maxRunwayCredits:10})))?.maxRunwayCredits,20);
  await assert.rejects(verifyExecutionApproval(approval.token,input({missionId:'other'})),/different mission/);
  await assert.rejects(verifyExecutionApproval(approval.token,input({maxRunwayCredits:21})),/exceeds/);
  await assert.rejects(verifyExecutionApproval(`x${approval.token}`,input()));
});

test('local render access fails closed and requires an operator token', () => {
  delete process.env.LOCAL_RENDER_ENABLED;
  assert.equal(renderAccessStatus(new Headers()),503);
  Object.assign(process.env,{LOCAL_RENDER_ENABLED:'true',STORAGE_DRIVER:'local',LOCAL_MEDIA_ROOT:'/tmp/proof',RENDER_TOKEN:'test-render-token-12345678901234567890'});
  assert.equal(renderAccessStatus(new Headers()),401);
  assert.equal(renderAccessStatus(new Headers({Authorization:`Bearer ${process.env.RENDER_TOKEN}`})),null);
  process.env.STORAGE_DRIVER='r2';
  assert.equal(renderAccessStatus(new Headers()),503);
});

test('MuseTalk submits through the orchestrator only to an advertised MuseTalk engine', async () => {
  Object.assign(process.env,{GPU_WORKER_URL:'https://worker.example',GPU_WORKER_TOKEN:'test'});
  const calls: Array<{url:string;body?:Record<string,unknown>}> = [];
  mock.method(globalThis,'fetch',async (url:string, init:RequestInit) => {
    calls.push({url,body:init.body?JSON.parse(String(init.body)):undefined});
    return Response.json(url.endsWith('/health') ? {ok:true,generationReady:true,generationEngines:['musetalk']} : {accepted:true,jobId:'test-job'});
  });
  const result=await executeWithFallback(input());
  assert.equal(result.submission?.providerId,'local-musetalk');
  assert.equal(calls[1].body?.engine,'musetalk');
  assert.equal(calls[1].body?.duration_seconds,8);
  assert.equal(calls[1].body?.source_image_url,input().sourceImageUrl);
});

test('MuseTalk does not submit to a Wan-only worker or without source audio', async () => {
  Object.assign(process.env,{GPU_WORKER_URL:'https://worker.example',GPU_WORKER_TOKEN:'test'});
  let submits=0;
  mock.method(globalThis,'fetch',async (url:string) => {
    if(url.endsWith('/jobs')) submits++;
    return Response.json({ok:true,generationReady:true,generationEngines:['wan']});
  });
  assert.equal((await executeWithFallback(input())).submission,null);
  assert.equal((await executeWithFallback(input({audioUrl:undefined}))).submission,null);
  assert.equal(submits,0);
});

test('Runway request caps cannot raise the configured server ceiling', async () => {
  Object.assign(process.env,{RUNWAYML_API_SECRET:'test',RUNWAY_ROUTER_CONFIG_ID:'test',RUNWAY_MAX_CREDITS_PER_GENERATION:'10'});
  mock.method(globalThis,'fetch',async()=>Response.json({routing:{estimatedCost:15}}));
  const preflight=await runwayAdapter.preflight(input({candidateProviderIds:['runway'],maxRunwayCredits:100}));
  assert.equal(preflight.ok,false);
  assert.match(preflight.detail,/cap of 10/);
});
