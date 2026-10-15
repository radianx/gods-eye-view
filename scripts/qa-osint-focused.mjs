import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const pr = process.env.OSINT_PR;
const base = 'http://localhost:4173';
const output = path.resolve('qa-shots/osint-focused');
await fs.mkdir(output, { recursive: true });
const report = { pr, live: null, checks: [] };
function check(name, value) {
  report.checks.push({ name, passed: Boolean(value) });
  console.log((value ? 'PASS ' : 'FAIL ') + name);
  assert.ok(value, name);
}
if (pr === '2') {
  const response = await fetch(base + '/api/fire-perimeters', { signal: AbortSignal.timeout(170000) });
  const data = await response.json();
  report.live = { status: response.status, sources: data.sources, rows: data.rows?.length, infona: data.rows?.filter(row => row.source === 'INFONA').slice(0, 2).map(({polygons, ...facts}) => facts) };
} else if (pr === '5') {
  const { createDmhObservationSource } = await import(pathToFileURL(path.resolve('server/providers/regional/dmh.js')));
  report.live = await createDmhObservationSource().getObservation({latitude: -25.28, longitude: -57.63});
}
console.log('LIVE ' + JSON.stringify(report.live));
const browser = await puppeteer.launch({headless: true, protocolTimeout: 180000, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader']});
let page;
try {
  page = await browser.newPage();
  await page.setViewport({width:1440,height:900});
  const errors=[];
  const packRequests=[];
  page.on('request', r=>{ if(r.url().includes('/argentina_admin/departments.json'))packRequests.push(r.url()); });
  page.on('pageerror', e=>errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    sessionStorage.setItem('gev:first-run-mission-session:v1','dismissed');
    window.__osintText = new Set();
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text,...args) {
      if(this.canvas.id === 'world-overlay-canvas' && window.__osintText.size < 300) window.__osintText.add(String(text));
      return original.call(this,text,...args);
    };
  });
  if(pr === '2') {
    const {normalizeInfonaPerimeterSnapshot}=await import(pathToFileURL(path.resolve('src/layers/perimeters/records.js')));
    const rows=normalizeInfonaPerimeterSnapshot({features:[{type:'Feature',properties:{id:'QA',objectid:1,date:Date.UTC(2026,9,14),sup_ha:7.36,dpto_desc:'CENTRAL',dist_desc:'ASUNCION QA'},geometry:{type:'Polygon',coordinates:[[[-57.73,-25.38],[-57.53,-25.38],[-57.53,-25.18],[-57.73,-25.18],[-57.73,-25.38]]]}}]});
    await page.setRequestInterception(true);
    page.on('request',request=>{
      const url=new URL(request.url());
      if(url.pathname==='/api/fire-perimeters')return request.respond({status:200,contentType:'application/json',body:JSON.stringify({rows,sources:{infona:{status:'ok'},wfigs:{status:'unavailable'}},partial:true})});
      if(url.pathname.startsWith('/api/inciweb'))return request.respond({status:200,contentType:'application/json',body:JSON.stringify({rows:[]})});
      return request.continue();
    });
  }
  await page.goto(base+'/?welcome=0',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__godsEyeView?.styleManager && document.getElementById('loading-screen')?.classList.contains('hidden'),{timeout:90000});
  await page.evaluate(()=>window.__godsEyeView.styleManager.initialRestorePromise);
  if(pr==='2') {
    const facts=await page.evaluate(async()=>{
      const app=window.__godsEyeView;
      for(const [id,entry] of app.dataManager.layers)if(entry.enabled)await app.dataManager.setEnabled(id,false,{origin:'user'});
      const v=app.viewer;
      // Flat, untextured background isolates perimeter rendering from tile services.
      v.imageryLayers.removeAll();
      v.terrainProvider=new window.__CESIUM__.EllipsoidTerrainProvider();
      v.scene.globe.baseColor=window.__CESIUM__.Color.DARKSLATEGRAY;
      for(let i=0;i<v.scene.postProcessStages.length;i++)v.scene.postProcessStages.get(i).enabled=false;
      const C=v.camera.position.constructor;
      v.camera.cancelFlight();
      v.camera.setView({destination:C.fromDegrees(-57.63,-25.28,90000),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});
      await app.dataManager.setEnabled('fire-perimeters',true,{origin:'user'});
      const layer=app.dataManager.layers.get('fire-perimeters').module;
      await layer.update();
      v.scene.requestRender();
      return {stats:layer.getStats(),legend:layer.getRowControls().legend,rows:layer.getAnalystRecords()};
    });
    check('INFONA loads in the existing layer with partial-source warning',facts.stats.count===1 && facts.stats.error.includes('WFIGS: unavailable'));
    check('estimated area has its own purple legend band',facts.legend.at(-1).color==='#b388ff' && facts.legend.at(-1).count===1 && facts.legend.slice(0,-1).every(x=>x.count===0));
    check('analyst retains source, area and unknown containment',facts.rows[0].source==='INFONA' && facts.rows[0].hectares===7.36 && facts.rows[0].containedPct===null);
    await page.waitForFunction(()=>{
      const v=window.__godsEyeView.viewer;
      const C=v.camera.position.constructor;
      const p=v.scene.cartesianToCanvasCoordinates(C.fromDegrees(-57.63,-25.28));
      window.__godsEyeView.requestRender('osint-browser-proof');
      v.render();
      const picked=p && v.scene.pick(p);
      const id=typeof picked?.id==='string'?picked.id:picked?.id?.id;
      return id?.startsWith('fire-perimeter:');
    },{timeout:60000,polling:500});
    const click=await page.evaluate(()=>{
      const v=window.__godsEyeView.viewer;
      const p=v.scene.cartesianToCanvasCoordinates(v.camera.position.constructor.fromDegrees(-57.63,-25.28));
      const r=v.scene.canvas.getBoundingClientRect();
      return{x:p.x+r.left,y:p.y+r.top};
    });
    await page.mouse.click(click.x,click.y);
    await page.waitForFunction(()=>[...window.__osintText].some(text=>text.startsWith('FIRE ESTIMATE')),{timeout:20000});
    const painted=await page.evaluate(()=>[...window.__osintText]);
    check('real map click paints estimated-area card with attribution',painted.some(x=>x.includes('INFONA')) && painted.some(x=>x.includes('7.36')) && !painted.some(x=>/InciWeb|% contained/.test(x)));
    report.fixture={facts,painted};
  } else if (pr === '3') {
    await page.evaluate(async()=>{
      const app=window.__godsEyeView;
      for(const [id,entry] of app.dataManager.layers)if(entry.enabled)await app.dataManager.setEnabled(id,false,{origin:'user'});
    });
    report.outlines=[];
    for(const [target,lat,lon,height] of [
      ['Departamento Capital, Misiones',-27.4,-55.9,80000],
      ['Partido de La Matanza, Buenos Aires',-34.8,-58.6,90000],
      ['Comuna 1, CABA',-34.6,-58.37,14000],
    ]){
      const result=await page.evaluate(async({target,lat,lon,height})=>{
        const app=window.__godsEyeView,v=app.viewer;
        app.annotations.clear();
        v.camera.cancelFlight();
        v.camera.setView({destination:v.camera.position.constructor.fromDegrees(lon,lat,height),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});
        const start=performance.now();
        const response=await app.annotations.annotate([{type:'area',target,label:target,footprint:true}],{flyTo:false});
        app.requestRender('osint-outline-proof');
        return {response:response.results?.[0],resolvedMs:performance.now()-start,mark:app.annotations.list().map(({id,label,pendingOutline})=>({id,label,pendingOutline}))};
      },{target,lat,lon,height});
      check(target+' resolves to a bundled area',result.response?.ok && result.response?.outline && result.response?.resolvedVia==='bundled');
      await page.waitForFunction(()=>{
        const app=window.__godsEyeView,v=app.viewer;
        app.requestRender('osint-outline-proof');
        v.render();
        return v.dataSourceDisplay.ready && v.scene.groundPrimitives.length>0;
      },{timeout:90000,polling:500});
      const rendered=await page.evaluate(()=>{
        const v=window.__godsEyeView.viewer;
        for(let i=0;i<v.dataSources.length;i++){
          const s=v.dataSources.get(i);
          if(s.name==='gev-annotations')return {entities:s.entities.values.length,polygons:s.entities.values.filter(e=>e.polygon).length,ready:v.dataSourceDisplay.ready,primitives:v.scene.groundPrimitives.length};
        }
      });
      check(target+' produces ready outline geometry',rendered?.polygons>0 && rendered.ready);
      await page.screenshot({path:path.join(output,'argentina-'+report.outlines.length+'.png')});
      report.outlines.push({target,...result,rendered});
    }
    check('Argentina pack is fetched once lazily',packRequests.length===1);
  } else {
    const observation={source:'DMH / DINAC',stationName:'ASUNCION QA',latitude:-25.28,longitude:-57.63,distanceM:1234,observedAt:new Date().toISOString(),temperatureC:0,humidityPct:0,windKph:0,windDirectionDeg:0};
    const value=await page.evaluate(observation=>{
      const c=window.__godsEyeView.styleManager.cockpitView;
      const info={latitude:-25.28,longitude:-57.63};
      const payload={status:'partial',articles:[],place:{label:'Asunción QA'},weather:{temperatureC:24,weatherCode:3,precipitationMm:0.1},stationObservation:observation};
      document.body.classList.add('cockpit-mode');
      document.getElementById('cockpit-hud').hidden=false;
      document.getElementById('cockpit-signal-stream').hidden=false;
      c.setSignalCollapsed(false); c.showBriefPage(2); c.renderRegionalBrief(payload,info);
      const p=document.getElementById('cockpit-local-observation');
      const observed={hidden:p.hidden,text:p.textContent,model:document.getElementById('cockpit-local-temperature').textContent,rect:p.getBoundingClientRect().toJSON()};
      c.renderRegionalBrief({...payload,stationObservation:{...observation,observedAt:new Date(Date.now()-91*60000).toISOString()}},info);
      const expired=p.hidden && p.textContent==='';
      c.renderRegionalBrief(payload,info);
      c.renderRegionalBriefStatus('loading',info);
      const cleared=p.hidden && p.textContent==='';
      c.renderRegionalBrief(payload,info);
      return{observed,expired,cleared};
    },observation);
    check('DMH station appears separately from modeled temperature',!value.observed.hidden && value.observed.text.includes('DMH / DINAC') && value.observed.text.includes('ASUNCION QA') && value.observed.model==='24°C');
    check('station time, distance and valid zero values are visible',value.observed.text.includes('UTC') && value.observed.text.includes('1.2 KM') && value.observed.text.includes('0.0°C') && value.observed.text.includes('RH 0%') && value.observed.rect.width>0 && value.observed.rect.height>0);
    check('expired readings and subject loading clear the observation',value.expired && value.cleared);
    report.fixture=value;
  }
  await page.screenshot({path:path.join(output,'pr-'+pr+'.png')});
  check('no uncaught application errors',errors.length===0);
} catch(error) {
  report.failure=error.message;
  if (page) report.scene = await page.evaluate(() => {
    const v=window.__godsEyeView?.viewer;
    if(!v)return {};
    const C=v.camera.position.constructor;
    const p=v.scene.cartesianToCanvasCoordinates(C.fromDegrees(-57.63,-25.28));
    const pick=p && v.scene.pick(p);
    return {camera:v.camera.positionCartographic,globe:v.scene.globe.show,screen:p,pickedId:typeof pick?.id==='string'?pick.id:pick?.id?.id,
      sources:Array.from({length:v.dataSources.length},(_,i)=>v.dataSources.get(i)).filter(s=>s.name==='fire-perimeters').map(s=>({name:s.name,show:s.show,entities:s.entities.values.map(e=>({id:e.id,show:e.show,polygon:Boolean(e.polygon)}))})),
      dataSourceReady:v.dataSourceDisplay.ready,groundPrimitives:v.scene.groundPrimitives.length,painted:[...window.__osintText]};
  }).catch(()=>null);
  console.error(error);
  if(page)console.log('SCREENSHOT_BASE64='+await page.screenshot({type:'jpeg',quality:35,encoding:'base64',clip:{x:400,y:180,width:640,height:480}}).catch(()=>''));
  process.exitCode=1;
  if(page)await page.screenshot({path:path.join(output,'failure-'+pr+'.png')}).catch(()=>{});
} finally {
  await browser.close();
  await fs.writeFile(path.join(output,'pr-'+pr+'.json'),JSON.stringify(report,null,2));
  console.log('REPORT '+JSON.stringify(report));
}
