import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  downloadFreeScene, normalizeFreeSceneQuery, safePexelsVideoUrl,
  searchFreeScenes, selectFreeSceneFile, validatedFreeSceneIds,
} from '../lib/free-footage';

const pexelsMedia = {
  id: 123456,
  width: 1280,
  height: 720,
  duration: 8,
  url: 'https://www.pexels.com/video/123456/',
  image: 'https://images.pexels.com/videos/123456/preview.jpg',
  user: { name:'Test Creator', url:'https://www.pexels.com/@test-creator' },
  video_files: [{
    file_type:'video/mp4',quality:'hd',width:1280,height:720,
    link:'https://player.vimeo.com/external/123456.hd.mp4?s=mock',
  }, {
    file_type:'video/mp4',quality:'hd',width:1920,height:1080,
    link:'https://player.vimeo.com/external/123456.4k.mp4',
  }],
};

test('reject invalid free scene selectors and unknown hosts', () => {
  assert.equal(normalizeFreeSceneQuery('  mountain   sunrise  '), 'mountain sunrise');
  assert.throws(() => normalizeFreeSceneQuery('x'));
  assert.deepEqual(validatedFreeSceneIds([123,456]),[123,456]);
  assert.throws(() => validatedFreeSceneIds([123,123]));
  assert.throws(() => validatedFreeSceneIds(['https://evil.invalid']));
  assert.equal(safePexelsVideoUrl('http://127.0.0.1/private.mp4'),null);
  assert.equal(safePexelsVideoUrl('https://player.vimeo.com.evil.test/file.mp4'),null);
  assert.equal(safePexelsVideoUrl('https://player.vimeo.com:8443/file.mp4'),null);
  assert.equal(selectFreeSceneFile(pexelsMedia.video_files), pexelsMedia.video_files[0].link);
});

test('searches only the documented official Pexels API with private token', async () => {
  let calls = 0;
  const stub = (async(input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    assert.match(String(input), /^https:\/\/api\.pexels\.com\/v1\/videos\/search\?/);
    assert.match(String(input), /query=mountain\+sunrise/);
    assert.equal(new Headers(init?.headers).get('Authorization'),'not-a-real-pexels-key');
    assert.equal(init?.redirect,'error');
    return Response.json({videos:[pexelsMedia]});
  }) as typeof fetch;
  const scenes = await searchFreeScenes('mountain sunrise','landscape','not-a-real-pexels-key',stub);
  assert.equal(calls,1);
  assert.equal(scenes[0].author, 'Test Creator');
  assert.equal(scenes[0].downloadAvailable,true);
  assert.equal(scenes[0].pageUrl,'https://www.pexels.com/video/123456/');
});

test('downloads verified video ID to a bounded private MP4, not a user URL', async () => {
  const folder=await mkdtemp(join(tmpdir(),'mabrig-footage-'));
  try {
    const expected = Buffer.alloc(2048, 9);
    let calls=0;
    const stub = (async(input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if(calls===1){
        assert.equal(String(input),'https://api.pexels.com/v1/videos/videos/123456');
        assert.equal(new Headers(init?.headers).get('Authorization'),'not-a-real-pexels-key');
        return Response.json(pexelsMedia);
      }
      assert.equal(String(input),pexelsMedia.video_files[0].link);
      assert.equal(init?.redirect,'error');
      return new Response(expected,{status:200,headers:{'Content-Type':'video/mp4'}});
    }) as typeof fetch;
    const output=join(folder,'clip.mp4');
    const result=await downloadFreeScene(123456,output,'not-a-real-pexels-key',3000,stub);
    assert.equal(result.bytes,2048);
    assert.equal(result.scene.author,'Test Creator');
    assert.deepEqual(await readFile(output),expected);
    assert.equal(calls,2);
  }finally{
    await rm(folder,{recursive:true,force:true});
  }
});

test('fails closed on an untrusted supplier URL before any media fetch', async () => {
  const folder=await mkdtemp(join(tmpdir(),'mabrig-footage-'));
  try {
    let calls=0;
    const stub=(async () => {
      calls++;
      return Response.json({
        ...pexelsMedia,
        video_files:[{file_type:'video/mp4',width:720,height:720,link:'https://evil.example/clip.mp4'}],
      });
    }) as typeof fetch;
    await assert.rejects(
      downloadFreeScene(123456,join(folder,'clip.mp4'),'not-a-real-pexels-key',3000,stub),
      /No compatible, trusted MP4/,
    );
    assert.equal(calls,1);
    assert.deepEqual(await readdir(folder),[]);
  }finally{
    await rm(folder,{recursive:true,force:true});
  }
});

test('rejects undersized clip budget before sending any request', async () => {
  await assert.rejects(downloadFreeScene(123456,'/tmp/no.mp4','not-a-real-pexels-key',3),/Invalid footage download budget/);
});
