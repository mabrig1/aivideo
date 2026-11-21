import assert from 'node:assert/strict';
import test from 'node:test';
import {extractVideoCandidates,safeHfCandidate,CURATED_VIDEO_MODELS} from '../lib/free-video-scout';

test('scout accepts only valid public model IDs from selected video families',()=>{
 const results=extractVideoCandidates([
  {id:'Wan-AI/Wan2.1-T2V-1.3B',private:false},
  {id:'Lightricks/LTX-Video',gated:false},
  {id:'other/text-only'},
  {id:'bad/../../model'},
  {id:'Wan-AI/secret',private:true},
  {id:'wan/private',gated:'auto'}
 ]);
 assert.equal(results.length,2);
 assert.equal(results[0].freeCloudCredits,'unverified');
 assert.equal(results[0].apiIntegration,'not-connected');
 assert.ok(results.every(x=>x.officialUrl.startsWith('https://huggingface.co/')));
});
test('scout does not invent free monthly allowances or auto activation',()=>{
 assert.equal(safeHfCandidate({id:'Wan-AI/Wan2.2',gated:'manual'}),null);
 for(const x of CURATED_VIDEO_MODELS){
  assert.equal(x.freeCloudCredits,'unverified');
  assert.notEqual(x.apiIntegration,'connected');
 }
});
