import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const pack = process.env.WEBCAM_PACK;
const isVaritech = pack === 'varitech';
const provider = await import(pathToFileURL(path.resolve('server/providers/cctv/' + (isVaritech ? 'varitech.js' : 'monteHermoso.js'))));
const cameras = isVaritech ? provider.loadVaritechSourcesFromCatalog() : provider.loadMonteHermosoSources();
const expected = isVaritech ? 11 : 1;
const kind = isVaritech ? 'varitech-webcam' : 'monte-hermoso-webcam';
const flag = isVaritech ? 'CCTV_VARITECH_ENABLED' : 'CCTV_MONTE_HERMOSO_ENABLED';
assert.equal(cameras.length, expected);
const { createCctvCatalog } = await import(pathToFileURL(path.resolve('server/providers/cctv/catalog.js')));
const saved = { ...process.env };
const actualFetch = globalThis.fetch;
try {
  delete process.env[flag];
  delete process.env.CCTV_SOURCES_JSON;
  process.env.CCTV_SOURCES_FILE = '/tmp/no-webcam-source-file.json';
  process.env.CCTV_FORCE_AUSTIN = '1';
  globalThis.fetch = async () => new Response('[]', { status: 404 });
  const enabled = (await createCctvCatalog()()).filter(c => c.sourceKind === kind);
  assert.equal(enabled.length, expected);
  assert.ok(enabled.every(c => c.name.includes('(approx. location)') && c.headingConfidence === 'low' && c.poseSource === undefined));
  process.env[flag] = '0';
  assert.equal((await createCctvCatalog()()).filter(c => c.sourceKind === kind).length, 0);
  console.log('CATALOG_PROOF ' + JSON.stringify({ pack, enabled: enabled.length, disabled: 0, labels: 'approximate', headings: 'estimated' }));
} finally {
  globalThis.fetch = actualFetch;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
const fixture = {
  id:'qa-austin', name:'QA Austin fixture', city:'Austin', provider:'Test fixture',
  sourceKind:'fixture', feedType:'image', url:'http://localhost:4173/__webcam_qa.jpg',
  lat:30.2672, lon:-97.7431, headingDeg:180, pitchDeg:-18, fovDeg:56,
  rangeM:210, mountHeightM:10, groundElevationM:147,
};
await fs.mkdir('qa-artifacts',{recursive:true});
await fs.writeFile('/tmp/gev-webcam-sources.json',JSON.stringify([fixture,...cameras]));
await fs.writeFile('public/__webcam_qa.html','<!doctype html><html><body><video id="video" muted autoplay playsinline controls width="960"></video></body></html>');
await sharp({create:{width:320,height:180,channels:3,background:{r:50,g:100,b:150}}}).jpeg().toFile('public/__webcam_qa.jpg');
console.log('Prepared isolated CCTV catalog with '+expected+' real sources and one Austin geometry fixture.');
