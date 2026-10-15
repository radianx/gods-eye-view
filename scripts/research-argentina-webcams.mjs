import fs from 'node:fs/promises';
import sharp from 'sharp';
import puppeteer from 'puppeteer';

await fs.mkdir('qa-artifacts/webcams', { recursive: true });
const result = { checkedAt: new Date().toISOString(), pages: [], images: [], browser: [] };
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { response, bytes };
}
const pages = [
  'https://varitech.ar/api/status',
  'https://varitech.ar/api/centers',
  'https://varitech.ar/camara/cam001',
  'https://varitech.ar/camara/cam016',
  'https://varitech.ar/camara/cam031',
  'https://www.noticiasmontehermoso.com.ar/camara-de-monte-hermoso-en-vivo/',
  'https://www.noticiasmontehermoso.com.ar/camara-en-vivo-desde-costanera-y-patagonia/',
];
for (const url of pages) {
  try {
    const { response, bytes } = await get(url);
    const body = bytes.toString('utf8');
    const file = 'qa-artifacts/webcams/page-' + result.pages.length + '.txt';
    await fs.writeFile(file, body);
    const row = { url, status: response.status, contentType: response.headers.get('content-type'), cors: response.headers.get('access-control-allow-origin'), bytes: bytes.length,
      matches: [...body.matchAll(/.{0,150}(?:m3u8|<iframe|latitude|longitude|geo:|latitud|longitud|lat:|lon:|castr|encoder-|guardalavaca).{0,350}/gi)].map(m => m[0]).slice(0,35),
      scripts: [...body.matchAll(/<script[^>]*src=["']([^"']+)/gi)].map(m=>m[1]) };
    if (response.headers.get('content-type')?.includes('json')) row.json = JSON.parse(body);
    result.pages.push(row);
    console.log('PAGE ' + JSON.stringify(row));
  } catch (error) { console.log('PAGE_ERROR ' + JSON.stringify({url,error:error.message})); }
}
for (const id of ['cam001','cam002','cam003','cam004','cam005','cam008','cam016','cam017','cam018','cam031','cam032']) {
  const url = 'https://varitech.ar/cameras/' + id + '/latest.jpg';
  try {
    const { response, bytes } = await get(url);
    const metadata = await sharp(bytes).metadata();
    const row = { id, url, status: response.status, contentType: response.headers.get('content-type'), cors: response.headers.get('access-control-allow-origin'), lastModified: response.headers.get('last-modified'), cacheControl: response.headers.get('cache-control'), format: metadata.format, width: metadata.width, height: metadata.height, bytes: bytes.length };
    result.images.push(row);
    console.log('IMAGE ' + JSON.stringify(row));
  } catch (error) { console.log('IMAGE_ERROR ' + JSON.stringify({id,error:error.message})); }
}
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  const streams = new Set();
  const pending = [];
  page.on('response', (response) => {
    if (!/\.m3u8(?:[?#]|$)/i.test(response.url())) return;
    const task = (async () => {
      try {
        const row = { url: response.url(), status: response.status(), headers: Object.fromEntries(Object.entries(response.headers()).filter(([k])=>['content-type','access-control-allow-origin','cache-control'].includes(k))), body: (await response.text()).slice(0,8000) };
        result.browser.push(row); console.log('PLAYLIST ' + JSON.stringify(row)); streams.add(row.url);
      } catch (error) { console.log('PLAYLIST_ERROR ' + JSON.stringify({ url: response.url(),error:error.message })); }
    })();
    pending.push(task);
  });
  for (const url of [
    'https://www.noticiasmontehermoso.com.ar/camara-de-monte-hermoso-en-vivo/',
    'https://www.noticiasmontehermoso.com.ar/camara-en-vivo-desde-costanera-y-patagonia/',
  ]) {
    try {
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000});
      await new Promise(r=>setTimeout(r,12000));
      console.log('BROWSER_PAGE ' + JSON.stringify({ url, title: await page.title(), frames: page.frames().map(f=>f.url()), videos: await page.$$eval('video',els=>els.map(e=>({src:e.currentSrc,readyState:e.readyState,width:e.videoWidth,height:e.videoHeight}))) }));
      const button = await page.$('button[data-cam="guardalavaca"]');
      if (button) { await button.click(); await new Promise(r=>setTimeout(r,6000)); }
    } catch (error) { console.log('BROWSER_ERROR ' + JSON.stringify({url,error:error.message})); }
  }
  await Promise.allSettled(pending);
} finally { await browser.close(); }
await fs.writeFile('qa-artifacts/webcams/report.json', JSON.stringify(result,null,2));
