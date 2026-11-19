import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffEnabled,handoffAuthorized,parseHandoff,handoffHash} from '../lib/agentos-handoff';

const input={
 sourceJobId:'123e4567-e89b-42d3-a456-426614174000',
 sourceDraftId:'123e4567-e89b-42d3-a456-426614174001',
 projectId:'mabrig-technologies',
 brief:'Promote an authentic AI training demonstration',
 script:'Today we explore real AI collaboration, verify results and show the limitations clearly.',
 targetPlatforms:['youtube','tiktok']
};
test('handoff rejects unsafe inputs, duplicate platforms and oversized script',()=>{
 assert.deepEqual(parseHandoff(input),input);
 assert.equal(parseHandoff({...input,sourceJobId:'../../private'}),null);
 assert.equal(parseHandoff({...input,script:'short'}),null);
 assert.equal(parseHandoff({...input,script:'x'.repeat(6001)}),null);
 assert.equal(parseHandoff({...input,targetPlatforms:['youtube','youtube']}),null);
 assert.equal(parseHandoff({...input,targetPlatforms:['unknown']}),null);
 assert.equal(parseHandoff({...input,targetPlatforms:[]}),null);
 assert.equal(parseHandoff({...input,projectId:'../etc'}),null);
});
test('fail closed until flag, token and mongo are configured',()=>{
 const secret='s'.repeat(40);
 const env={AGENTOS_HANDOFF_ENABLED:'true',AGENTOS_HANDOFF_TOKEN:secret,MONGODB_URI:'mongodb://localhost:27017/test'};
 assert.equal(handoffEnabled(env),true);
 assert.equal(handoffAuthorized('Bearer '+secret,env),true);
 assert.equal(handoffAuthorized('Bearer invalid',env),false);
 assert.equal(handoffEnabled({...env,AGENTOS_HANDOFF_ENABLED:'false'}),false);
 assert.equal(handoffEnabled({...env,AGENTOS_HANDOFF_TOKEN:'short'}),false);
 assert.equal(handoffEnabled({...env,MONGODB_URI:''}),false);
 assert.equal(handoffAuthorized('Bearer '+secret,{...env,AGENTOS_HANDOFF_ENABLED:'false'}),false);
});
test('canonical handoff fingerprints reflect meaningful payload changes',()=>{
 const a=parseHandoff(input);
 assert.ok(a);
 if(!a) return;
 assert.equal(handoffHash(a),handoffHash(a));
 assert.notEqual(handoffHash(a),handoffHash({...a,script:a.script+' Revised.'}));
});
