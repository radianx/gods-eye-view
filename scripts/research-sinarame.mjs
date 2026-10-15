import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
const req = createRequire('/tmp/sinarame-probe/package.json');
const { default: puppeteer } = await import(req.resolve('puppeteer'));
const { PNG } = req('pngjs');
const BASE = 'https://radares.hidricosargentina.gob.ar/';
const OUT = 'research-output';
await fs.mkdir(OUT, { recursive: true });
const report = { checkedAt: new Date().toISOString(), pages: [], responses: [], replay: [], cors: [] };
const pending = new Set();
const log = (kind, value) => console.log(kind + ' ' + JSON.stringify(value));
const safeUrl = (s) => {
  const u = new URL(s, BASE);
  for (const k of [...u.searchParams.keys()]) if (/token|auth|key|session|connection|^id$/i.test(k)) u.searchParams.set(k, '[redacted]');
  return u.href;
};
const safeHeaders = h => Object.fromEntries(Object.entries(h).filter(([k]) => /^(content-type|content-length|cache-control|last-modified|etag|access-control-allow-origin|access-control-allow-credentials|x-frame-options|content-security-policy|date)$/i.test(k)));
async function nativeGet(url, origin = false) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: origin ? { Origin: 'https://example.org', Referer: 'https://example.org/' } : {} });
    const buf = Buffer.from(await res.arrayBuffer());
    const item = { url: safeUrl(url), foreignOrigin: origin, status: res.status, headers: safeHeaders(Object.fromEntries(res.headers)), bytes: buf.length };
    if (/json|text|javascript|xml/.test(res.headers.get('content-type') || '')) item.text = buf.toString('utf8').slice(0, 4000);
    if (buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      const png = PNG.sync.read(buf);
      let transparent = 0, opaque = 0, partial = 0;
      const colors = new Set();
      for (let i = 0; i < png.data.length; i += 4) {
        const a = png.data[i + 3];
        if (a === 0) transparent++;
        else { if (a === 255) opaque++; else partial++; colors.add([...png.data.subarray(i, i + 4)].join(',')); }
      }
      item.png = { width: png.width, height: png.height, transparent, opaque, partial, colors: colors.size };
      if (!origin) { await fs.writeFile(OUT + '/' + new URL(url).pathname.replaceAll('/', '_'), buf); if (buf.length <= 100000) item.previewBase64 = buf.toString('base64'); }
    }
    return item;
  } catch(e) { return { url: safeUrl(url), foreignOrigin: origin, error: e.message, cause: e.cause?.code }; }
}
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1360, height: 900 });
page.on('console', m => { if (m.type() === 'error') log('CONSOLE', m.text().slice(0,2000)); });
page.on('pageerror', e => log('PAGE_ERROR', e.message));
page.on('response', res => {
  const work = (async () => {
    if (!res.url().startsWith(BASE) || report.responses.length >= 180) return;
    const item = { url: safeUrl(res.url()), status: res.status(), method: res.request().method(), headers: safeHeaders(res.headers()) };
    if (/json/.test(res.headers()['content-type'] || '') && !/_blazor/.test(res.url())) item.body = (await res.text()).slice(0,12000);
    report.responses.push(item);
  })().catch(e => log('CAPTURE_ERROR', e.message));
  pending.add(work); work.finally(() => pending.delete(work));
});
async function choose(selector, value) {
  for (let i = 0; i < 10; i++) {
    try { await page.waitForSelector(selector, { timeout: 5000 }); await page.select(selector, value); return; }
    catch (e) { if (i === 9) throw e; await new Promise(r => setTimeout(r, 500)); }
  }
}
async function snapshot(name) {
  const value = await page.evaluate(() => ({
    text: document.body.innerText.slice(0,12000),
    selects: [...document.querySelectorAll('select')].map((s,i) => ({ index:i, value:s.value, options:[...s.options].map(o => ({ value:o.value,text:o.text })) })),
    state: window.radarState ? { urls: window.radarState.urls, frameTimestamps: window.radarState.frameTimestamps,
      maps: Object.values(window.radarState.mapsByElementId).map(map => ({ crs:map.options.crs.code, layers:Object.values(map._layers).filter(l => l._url || l.getLatLng).map(l => ({ url:l._url,bounds:l.getBounds?.(),center:l.getLatLng?.(),radius:l.getRadius?.(),title:l.options?.title })) })) } : null,
    images: [...document.images].filter(i => /\/cache\//.test(i.src)).map(i => ({ url:i.src,width:i.naturalWidth,height:i.naturalHeight,complete:i.complete })),
    cookiesPresent: document.cookie.length > 0,
    browserTime: new Date().toISOString(),
    errorUi: [...document.querySelectorAll('#blazor-error-ui')].map(e => getComputedStyle(e).display),
  }));
  report.pages.push({ name,...value });
  await page.screenshot({ path: OUT+'/'+name+'.png', fullPage:true });
  log('PAGE', {name,...value});
}
try {
  await page.goto(BASE, {waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(() => (window.radarState?.pinLayers?.length || 0) >= 21, {timeout:45000});
  await new Promise(r => setTimeout(r, 1500));
  await snapshot('ready');
  await choose('#radar-selector','RMA13');
  try { await page.waitForFunction(() => window.radarState?.urls.some(u => u.includes('/RMA13/')), {timeout:60000}); } catch(e) { log('WAIT_ITUZAINGO',e.message); }
  await new Promise(r => setTimeout(r,2000));
  await snapshot('ituzaingo-latest');
  // Select the history control by its published option set.
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(s => [...s.options].map(o => o.value).join(',') === '1,6,12');
    if(s) { s.value='6'; s.dispatchEvent(new Event('change',{bubbles:true})); }
  });
  try { await page.waitForFunction(() => window.radarState?.urls.length >= 6, {timeout:30000}); } catch(e) { log('WAIT_HISTORY',e.message); }
  await snapshot('ituzaingo-history');
  await choose('#radar-selector','RMA5');
  try { await page.waitForFunction(() => window.radarState?.urls.some(u => u.includes('/RMA5/')), {timeout:45000}); } catch(e) { log('WAIT_BERNARDO',e.message); }
  await new Promise(r => setTimeout(r,2000));
  await snapshot('bernardo-history');
  await page.evaluate(() => {
    const s=[...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value==='Mosaic'));
    s.value='Mosaic'; s.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await new Promise(r => setTimeout(r,25000));
  await snapshot('mosaic');
} catch(e) { log('BROWSER_ERROR',e.message); }
await Promise.allSettled([...pending]);
for(const r of report.responses.filter(r => /\/cache\/|json/.test(r.url+' '+r.headers['content-type']))) log('RESPONSE',r);
const imageUrls = [...new Set(report.pages.flatMap(p => [...(p.state?.urls || []),...(p.images || []).map(i => i.url)]).map(u=>new URL(u,BASE).href))];
const selected = ['RMA13','RMA5'].map(id=>imageUrls.find(u=>u.includes('/'+id+'/'))).filter(Boolean);
if (!selected.length) selected.push(new URL('/cache/RMA1/20261015023000.png', BASE).href);
for(const url of selected) {
  for(const origin of [false,true]) { const r=await nativeGet(url,origin); report.replay.push(r); log('ANONYMOUS_REPLAY',r); }
}
for(const path of ['/cache/','/cache/RMA13/']) { const r=await nativeGet(new URL(path,BASE).href); report.replay.push(r); log('DIRECTORY',r); }
if(selected.length) {
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Independent origin probe</title>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const p=await browser.newPage(); await p.goto('http://127.0.0.1:'+server.address().port);
  const r=await p.evaluate(async url=>{
    const result={url,origin:location.origin};
    try {const res=await fetch(url,{signal:AbortSignal.timeout(15000)});result.fetch={status:res.status,bytes:(await res.arrayBuffer()).byteLength};}catch(e){result.fetch={error:e.message};}
    for(const cors of [false,true]) {
      result[cors?'imageAnonymousCors':'imagePlain']=await new Promise(resolve=>{
        const image=new Image(); if(cors) image.crossOrigin='anonymous';
        const timer=setTimeout(()=>resolve({timeout:true}),15000);
        image.onerror=()=>{clearTimeout(timer);resolve({loaded:false});};
        image.onload=()=>{clearTimeout(timer);const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
          let readable;try{ctx.getImageData(0,0,1,1);readable=true;}catch{readable=false;}
          resolve({loaded:true,width:image.width,height:image.height,canvasReadable:readable});};
        image.src=url;
      });
    }
    return result;
  },selected[0]);
  report.cors.push(r);log('BROWSER_CORS',r);
  await p.close();await new Promise(r=>server.close(r));
}
await browser.close();
await fs.writeFile(OUT+'/report.json',JSON.stringify(report,null,2));
log('DONE',{checkedAt:report.checkedAt,pages:report.pages.length,images:imageUrls.length});
