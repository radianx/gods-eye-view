import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const { default: puppeteer } = await import(createRequire('/tmp/sinarame-probe/package.json').resolve('puppeteer'));

const BASE = 'https://radares.hidricosargentina.gob.ar/';
const OUT = 'research-output';
await fs.mkdir(OUT, { recursive: true });
const report = { checkedAt: new Date().toISOString(), pages: [], responses: [], overlays: [], websocket: [], replay: [] };
const seen = new Set();
const safeUrl = (value) => {
  try {
    const u = new URL(value, BASE);
    for (const k of [...u.searchParams.keys()])
      if (/token|auth|key|session|connection|^id$/i.test(k)) u.searchParams.set(k, '[redacted]');
    return u.href;
  } catch { return String(value).slice(0, 300); }
};
const safeHeaders = (h) => Object.fromEntries(Object.entries(h).filter(([k]) =>
  /^(content-type|content-length|cache-control|last-modified|etag|access-control-allow-origin|access-control-allow-credentials|x-frame-options|content-security-policy|server|date)$/i.test(k)));
function log(kind, value) { console.log(kind + ' ' + JSON.stringify(value)); }
async function nativeGet(url, origin = false) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error',
      headers: origin ? { Origin: 'https://example.org', Referer: 'https://example.org/' } : {} });
    const length = Number(res.headers.get('content-length') || 0);
    if (length > 8 * 1024 * 1024) { await res.body?.cancel(); return { url: safeUrl(url), status: res.status, tooLarge: length }; }
    const buf = Buffer.from(await res.arrayBuffer());
    const item = { url: safeUrl(url), foreignOrigin: origin, status: res.status, headers: safeHeaders(Object.fromEntries(res.headers)), bytes: buf.length };
    if (/json|text|javascript|xml/.test(res.headers.get('content-type') || '')) item.text = buf.toString('utf8').slice(0, 60000);
    if (buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) item.png = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
    return item;
  } catch (e) { return { url: safeUrl(url), foreignOrigin: origin, error: e.message, cause: e.cause?.code }; }
}
const initial = await nativeGet(BASE);
await fs.writeFile(OUT + '/initial.json', JSON.stringify(initial, null, 2));
log('INITIAL', { ...initial, text: '[HTML captured separately]' });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1360, height: 900 });
const pending = new Set();
const observedImages = [];
page.on('response', (res) => {
  const work = (async () => {
    const url = res.url();
    const type = res.headers()['content-type'] || '';
    if (!url.startsWith(BASE) && !/radar|sinarame|hidricos|evarsa/i.test(url)) return;
    if (report.responses.length >= 160) return;
    const item = { url: safeUrl(url), status: res.status(), method: res.request().method(), type, headers: safeHeaders(res.headers()) };
    if ((/json/.test(type) || /javascript/.test(type) && url.startsWith(BASE) && !/_framework|_content/.test(url)) && !seen.has(url)) {
      seen.add(url);
      try { item.body = /_blazor/.test(url) ? '[session metadata omitted]' : (await res.text()).slice(0, 80000); } catch {}
    }
    if (/image\/png|image\/webp/.test(type) && !/logo|favicon|marker|header/.test(url) && observedImages.length < 8) observedImages.push(url);
    report.responses.push(item);
  })().catch(e => log('RESPONSE_ERROR', e.message));
  pending.add(work); work.finally(() => pending.delete(work));
});
page.on('pageerror', e => log('PAGE_ERROR', e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warn') log('CONSOLE', { type: m.type(), text: m.text().slice(0, 2500) }); });
page.on('requestfailed', req => log('REQUEST_FAILED', { url: safeUrl(req.url()), error: req.failure()?.errorText }));
const session = await page.createCDPSession();
await session.send('Network.enable');
session.on('Network.webSocketCreated', e => report.websocket.push({ event: 'created', url: safeUrl(e.url) }));
session.on('Network.webSocketFrameReceived', e => {
  const n = report.websocket.filter(x => x.event === 'frame').length;
  if (n < 6) report.websocket.push({ event: 'frame', opcode: e.response.opcode, length: e.response.payloadData.length });
});

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 15000));
  const snapshot = async (name) => {
    const value = await page.evaluate(() => ({
      text: document.body.innerText.slice(0, 16000),
      scripts: [...document.scripts].map(s => ({ src: s.src, inline: s.src ? null : s.textContent.slice(0, 10000) })),
      selects: [...document.querySelectorAll('select')].map((s, i) => ({ index: i, id: s.id, value: s.value, options: [...s.options].map(o => ({ value: o.value, text: o.text, selected: o.selected })) })),
      images: [...document.images].map(i => ({ url: i.src, width: i.naturalWidth, height: i.naturalHeight })),
      state: window.radarState ? {
        urls: window.radarState.urls,
        frameTimestamps: window.radarState.frameTimestamps,
        index: window.radarState.currentIndex,
        maps: Object.values(window.radarState.mapsByElementId).map(map => ({
          crs: map.options.crs.code,
          layers: Object.values(map._layers).map(layer => ({
            type: layer.constructor.name,
            url: layer._url,
            bounds: layer.getBounds?.(),
            center: layer.getLatLng?.(),
            title: layer.options?.title,
            radius: layer.getRadius?.(),
          })),
        })),
      } : null,
      errorUi: [...document.querySelectorAll('#blazor-error-ui, #components-reconnect-modal')].map(e => ({ id: e.id, display: getComputedStyle(e).display, open: e.open })),
      overlays: Object.values(window.radarState?.mapsByElementId || {}).flatMap(map => Object.values(map._layers).filter(l => l._url && l.getBounds).map(l => ({ url: l._url, bounds: l.getBounds() }))),
    }));
    report.pages.push({ name, ...value });
    await page.screenshot({ path: OUT + '/' + name + '.png', fullPage: true });
    log('PAGE', { name, ...value });
    return value;
  };
  const first = await snapshot('initial-browser');
  const mode = first.selects.find(s => s.options.some(o => /mosaico|individual/i.test(o.text)));
  if (mode) {
    const mosaic = mode.options.find(o => /mosaico/i.test(o.text));
    if (mosaic && mosaic.value !== mode.value) {
      await (await page.$$('select'))[mode.index].select(mosaic.value);
      await new Promise(r => setTimeout(r, 6000));
      await snapshot('mosaic');
    }
  }
  await (await page.$('select'))[0].select('Individual');
  await new Promise(r => setTimeout(r, 2000));
  await page.select('#radar-selector', 'RMA13');
  await new Promise(r => setTimeout(r, 8000));
  await snapshot('ituzaingo');
  await page.select('#radar-selector', 'RMA5');
  await new Promise(r => setTimeout(r, 8000));
  await snapshot('bernardo');
  report.overlays = report.pages.flatMap(p => p.overlays || []);
} catch (e) { log('BROWSER_ERROR', { error: e.message }); }
await Promise.allSettled([...pending]);
await browser.close();
for (const item of report.responses) log('RESPONSE', /javascript/.test(item.type) ? { ...item, body: '[script captured in artifact]' } : item);
log('WEBSOCKET', report.websocket);
const imageUrls = [...new Set([...observedImages, ...report.overlays.map(x => x.url).filter(x => typeof x === 'string' && !x.includes('{'))])].filter(x => /^https?:/.test(x) && !/tile.openstreetmap|arcgisonline|google|logo|favicon/i.test(x)).slice(0, 3);
for (const url of imageUrls) {
  for (const origin of [false, true]) {
    const result = await nativeGet(url, origin);
    report.replay.push(result); log('ANONYMOUS_REPLAY', result);
  }
}
await fs.writeFile(OUT + '/report.json', JSON.stringify(report, null, 2));
