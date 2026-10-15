import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import puppeteer from 'puppeteer';

const pack=process.env.WEBCAM_PACK;
const base='http://localhost:4173';
const all=(await (await fetch(base+'/api/cctv/sources')).json()).sources;
const cameras=all.filter(c=>c.sourceKind===(pack==='varitech'?'varitech-webcam':'monte-hermoso-webcam'));
assert.equal(cameras.length,pack==='varitech'?11:1);
assert.ok(cameras.every(c=>!('url' in c)&&c.name.includes('(approx. location)')&&c.headingConfidence==='low'));
const proof={pack,checkedAt:new Date().toISOString(),cameras:cameras.map(c=>({id:c.id,lat:c.lat,lon:c.lon,name:c.name})),frames:[]};
if(pack==='varitech'){
  for(const camera of cameras){
    const r=await fetch(base+'/api/cctv/frame/'+camera.id,{signal:AbortSignal.timeout(15000)});
    assert.equal(r.status,200);
    assert.equal(r.headers.get('x-cctv-source'),'upstream-image');
    const bytes=Buffer.from(await r.arrayBuffer());
    const meta=await sharp(bytes).metadata();
    assert.equal(meta.format,'jpeg');
    assert.equal(meta.width,1280);
    proof.frames.push({id:camera.id,width:meta.width,height:meta.height,bytes:bytes.length});
  }
  const media=await fetch(base+'/api/cctv/media/varitech-cam003',{redirect:'manual'});
  assert.equal(media.status,307);
  assert.equal(media.headers.get('location'),'/api/cctv/frame/varitech-cam003');
}
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader']});
let page;
const diagnostics=[];
try{
 page=await browser.newPage();
 page.on('pageerror',e=>diagnostics.push({pageerror:e.message}));
 page.on('requestfailed',r=>{if(r.url().includes('/api/cctv/'))diagnostics.push({failed:r.url(),error:r.failure()?.errorText});});
 page.on('response',r=>{if(r.url().includes('/api/cctv/media/'))diagnostics.push({status:r.status(),url:r.url()});});
 await page.setViewport({width:1280,height:800});
 await page.goto(base+'/__webcam_qa.html',{waitUntil:'domcontentloaded'});
 if(pack==='varitech'){
   proof.browserImage=await page.evaluate(async()=>{
     const img=new Image(); img.src='/api/cctv/frame/varitech-cam003';
     await img.decode(); document.body.appendChild(img);
     return {width:img.naturalWidth,height:img.naturalHeight};
   });
   assert.equal(proof.browserImage.width,1280);
 }else{
   await page.addScriptTag({url:base+'/__webcam_hls.js'});
   const id=cameras[0].id;
   await page.evaluate((id)=>{
     const video=document.getElementById('video'); video.muted=true;
     window.hls=new Hls();
     window.lease=crypto.randomUUID();
     window.hlsErrors=[];
     window.hls.on(Hls.Events.ERROR,(_event,data)=>{window.hlsErrors.push({details:data.details,fatal:data.fatal,reason:data.reason});if(data.fatal)window.hlsFailure=data.details;});
     window.hls.attachMedia(video);
     window.hls.loadSource('/api/cctv/media/'+id+'?lease='+window.lease);
     video.play().catch(()=>{});
   },id);
   await page.waitForFunction(()=>document.getElementById('video').currentTime>1 && document.getElementById('video').videoWidth>0,{timeout:45000});
   proof.browserVideo=await page.evaluate(()=>{const v=document.getElementById('video');return {width:v.videoWidth,height:v.videoHeight,currentTime:v.currentTime,readyState:v.readyState,fatalError:window.hlsFailure||null};});
   assert.equal(proof.browserVideo.width,1280);
   assert.equal(proof.browserVideo.fatalError,null);
   await page.screenshot({path:'qa-artifacts/'+pack+'-playback.png'});
   await page.evaluate(async(id)=>{window.hls.destroy();await fetch('/api/cctv/media/'+id+'?lease='+window.lease,{method:'DELETE'});},id);
 }
 await page.goto(base+'/?welcome=0',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__godsEyeView?.dataManager,{timeout:60000});
 const id=cameras[0].id;
 proof.app=await page.evaluate(async(id)=>{
   const dm=window.__godsEyeView.dataManager;
   if(!dm.layers.get('cctv').enabled)await dm.toggle('cctv');
   const mod=dm.layers.get('cctv').module;
   mod.setParams({selectedCameraId:id});
   const ui=mod.getUIState();
   return {count:ui.count,activeCameraId:ui.activeCameraId,camera:ui.cameras.find(c=>c.id===id)};
 },id);
 assert.equal(proof.app.activeCameraId,id);
 assert.match(proof.app.camera.name,/\(approx\. location\)$/);
 await page.screenshot({path:'qa-artifacts/'+pack+'-app.png'});
}catch(error){
 proof.error=String(error);
 proof.diagnostics=diagnostics.slice(-35);
 if(page)proof.browserFailure=await page.evaluate(()=>{const v=document.getElementById('video');return {href:location.href,video:v?{width:v.videoWidth,height:v.videoHeight,time:v.currentTime,readyState:v.readyState,paused:v.paused,networkState:v.networkState,error:v.error?{code:v.error.code,message:v.error.message}:null}:null,hlsErrors:window.hlsErrors||[]};}).catch(e=>({error:String(e)}));
 await fs.writeFile('qa-artifacts/'+pack+'-failure.json',JSON.stringify(proof,null,2));
 console.log('LIVE_FAILURE '+JSON.stringify(proof));
 throw error;
}finally{await browser.close();}
await fs.writeFile('qa-artifacts/'+pack+'-proof.json',JSON.stringify(proof,null,2));
console.log('LIVE_PROOF '+JSON.stringify(proof));
