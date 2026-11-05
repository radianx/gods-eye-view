// Drives the shipped middleware, with the actual 64-camera Argentina catalog.
// No network passthrough exists: every fetch is replaced before importing code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';

const policy = process.env.STREETVIEW_REVIEW_POLICY;
assert.ok(['1588', '666'].includes(policy));
const root = new URL('../../../', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('config/cctv_sources.argentina.json', root)));
const images = catalog.filter(c => c.feedType === 'image');
const embeds = catalog.filter(c => c.feedType === 'embed');
const hls = catalog.filter(c => c.feedType === 'hls');
let clock = 1_800_000_000_000;
Date.now = () => clock;
process.env.CCTV_SOURCES_FILE = 'config/cctv_sources.argentina.json';
process.env.CCTV_SOURCES_JSON = '[]';
process.env.CCTV_FORCE_AUSTIN = '0';
process.env.CCTV_PREFER_AUSTIN = '0';
process.env.CCTV_MAX_SOURCES = '1000';
process.env.GOOGLE_MAPS_SERVER_API_KEY = 'dummy-never-sent-to-network';
delete process.env.GOOGLE_MAPS_API_KEY;
delete process.env.GEV_RATELIMIT_GOOGLE_PER_MIN;
let recovered = false;
let googleOk = true;
let google = [];
let upstream = [];
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname === 'maps.googleapis.com') {
    assert.equal(url.pathname, '/maps/api/streetview');
    google.push(url);
    return googleOk
      ? new Response('mock-google-image', {headers: {'content-type':'image/jpeg'}})
      : new Response('mock-google-error', {status:503});
  }
  upstream.push(url.href);
  return recovered
    ? new Response('mock-restored-camera', {headers:{'content-type':'image/jpeg'}})
    : new Response('mock-camera-down', {status:503});
};
const { cctvProxy } = await import(new URL('server/providers/cctv.js', root));
function mount() {
  clock += 600_001;
  recovered = false;
  googleOk = true;
  google = [];
  upstream = [];
  let handler;
  const server = new EventEmitter();
  cctvProxy({sourceRoot: new URL(root).pathname}).configureServer({
    httpServer: server,
    middlewares:{use:(_path, fn) => {handler = fn;}}
  });
  return {
    close: () => server.emit('close'),
    async request(path, ip='127.0.0.1', headers={}) {
      let status;
      let responseHeaders = {};
      let body;
      const req = new EventEmitter();
      Object.assign(req,{url:path, method:'GET',headers,socket:{remoteAddress:ip}});
      const res = new EventEmitter();
      Object.assign(res,{
        writeHead(s,h){status=s;responseHeaders=h||{};},
        end(b){body=b;},
        setHeader(k,v){responseHeaders[k]=v;}
      });
      await handler(req,res);
      return {status,headers:responseHeaders,body,source:responseHeaders['X-CCTV-Source']};
    }
  };
}
const frame = (app,camera,query='',ip,headers) => app.request(`/frame/${camera.id}${query}`,ip,headers);
const summary = (name,data) => console.log(JSON.stringify({policy,scenario:name,...data}));

test('actual catalog: 64 cameras, 25 external, 24 HLS, 15 stills',()=>{
  assert.deepEqual([catalog.length,embeds.length,hls.length,images.length],[64,25,24,15]);
});

test('simultaneous still outage, refresh, reset, recovery',async t=>{
  const app=mount();t.after(app.close);
  const sweep=()=>Promise.all(images.map(c=>frame(app,c)));
  const first=await sweep();
  const firstPaid=google.length;
  assert.equal(first.filter(r=>r.source==='streetview').length,policy==='1588'?12:15);
  assert.equal(firstPaid,policy==='1588'?12:15);
  const second=await sweep();
  assert.equal(second.filter(r=>r.source==='streetview').length,policy==='1588'?0:15);
  assert.equal(google.length,firstPaid);
  clock+=60_000;
  const third=await sweep();
  assert.equal(third.filter(r=>r.source==='streetview').length,policy==='1588'?12:15);
  assert.equal(google.length,policy==='1588'?24:15);
  // Recovery must precede both a spent budget and a fresh cached Google image.
  const paidBeforeRecovery=google.length;
  recovered=true;
  for(const c of images){
    const r=await frame(app,c);
    assert.equal(r.source,'upstream-image',c.id);
    assert.equal(r.body.toString(),'mock-restored-camera');
  }
  assert.equal(google.length,paidBeforeRecovery);
  summary('outage',{firstPaid,firstServed:first.filter(r=>r.source==='streetview').length,refreshServed:second.filter(r=>r.source==='streetview').length,afterMinutePaid:paidBeforeRecovery,recovered:15});
});

test('all external players reject frame/media requests before fetch',async t=>{
  const app=mount();t.after(app.close);
  for(const c of embeds){
    assert.equal((await frame(app,c)).status,409);
    assert.equal((await app.request(`/media/${c.id}`)).status,409);
    const r=await app.request(`/stream/${c.id}`);
    const info=JSON.parse(r.body);
    assert.equal(info.frameUrl,null);assert.equal(info.mediaUrl,null);
    assert.ok(info.embedUrl);
  }
  assert.equal(google.length,0);assert.equal(upstream.length,0);
  summary('external',{rejected:50,fetches:0});
});

test('HLS stream routes and lease admission remain independent of Google',async t=>{
  const app=mount();t.after(app.close);
  for(const c of hls){
    const r=await app.request(`/stream/${c.id}`);
    const info=JSON.parse(r.body);
    assert.equal(info.feedType,'hls');
    assert.equal(info.mediaUrl,`/api/cctv/media/${c.id}`);
    // No lease: refuse before fetching a playlist, exactly as #1163 does.
    assert.equal((await app.request(`/media/${c.id}`)).status,400);
  }
  assert.equal(google.length,0);assert.equal(upstream.length,0);
});

test('unknown IDs, query coordinates and forwarded requests cannot redirect spending',async t=>{
  const app=mount();t.after(app.close);
  assert.equal((await frame(app,{id:'unknown'},'?lat=48.8&lon=2.3')).source,'synthetic');
  assert.equal(google.length,0);
  assert.equal((await frame(app,images[0],'?lat=48.8&lon=2.3&heading=12.25')).source,'streetview');
  assert.equal(google[0].searchParams.get('location'),`${images[0].lat},${images[0].lon}`);
  const paid=google.length;
  await frame(app,images[1],'',undefined,{'x-forwarded-for':'10.0.0.1'});
  assert.equal(google.length,paid);
});

test('one client exhaustion and a second client: actual fairness',async t=>{
  const app=mount();t.after(app.close);
  const limit=policy==='1588'?12:120;
  // Unique fractional poses defeat #666 cache without moving the location.
  for(let i=0;i<limit;i++) assert.equal((await frame(app,images[0],`?heading=${i/10}`,'10.0.0.1')).source,'streetview');
  assert.equal((await frame(app,images[0],'?heading=123.45','10.0.0.1')).source,'synthetic');
  const other=await frame(app,images[1],'','10.0.0.2');
  assert.equal(other.source,policy==='1588'?'synthetic':'streetview');
  const paid=google.length;
  recovered=true;
  assert.equal((await frame(app,images[0],'','10.0.0.1')).source,'upstream-image');
  assert.equal(google.length,paid);
  summary('fairness',{firstClientCap:limit,secondClient:other.source,paid:google.length,recoveredWhileExhausted:true});
});

test('aggregate backstop with multiple clients is finite',async t=>{
  const app=mount();t.after(app.close);
  const limit=policy==='1588'?12:2400;
  for(let i=0;i<limit;i++){
    const r=await frame(app,images[0],`?heading=${i/10000}`,`10.0.${Math.floor(i/120)}.1`);
    assert.equal(r.source,'streetview',`admission ${i}`);
  }
  assert.equal((await frame(app,images[1],'','10.99.0.1')).source,'synthetic');
  assert.equal(google.length,limit);
  summary('aggregate',{paid:limit});
});

test('failed Google attempts also consume quota',async t=>{
  const app=mount();t.after(app.close);googleOk=false;
  const limit=policy==='1588'?12:120;
  for(let i=0;i<limit+5;i++) assert.equal((await frame(app,images[0])).source,'synthetic');
  assert.equal(google.length,limit);
});

test('concurrent identical cache misses are not coalesced',async t=>{
  const app=mount();t.after(app.close);
  const responses=await Promise.all(Array.from({length:10},()=>frame(app,images[0])));
  assert.ok(responses.every(r=>r.source==='streetview'));
  assert.equal(google.length,10);
  summary('concurrentSameCamera',{requests:10,paid:google.length});
});

test('two plugin instances: #1588 budget is per instance, #666 limiter is shared',async t=>{
  const a=mount();t.after(a.close);
  const b=mount();t.after(b.close);
  const limit=policy==='1588'?12:120;
  for(let i=0;i<limit;i++) await frame(a,images[0],`?heading=${i/10}`);
  const r=await frame(b,images[1]);
  assert.equal(r.source,policy==='1588'?'streetview':'synthetic');
  summary('pluginInstances',{secondInstance:r.source,paid:google.length});
});
