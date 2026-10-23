import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  infrastructureDataUrls,
  loadInfrastructureFeatures,
  createInfrastructureSource,
  parseGeojsonLines,
  featurePoint,
} from '../sources/infrastructureData.js';
import { composeCatalog, coreTools } from '../tools/index.js';

const urls = infrastructureDataUrls('local-dams');
const packs = urls.map((url) =>
  parseGeojsonLines(readFileSync(new URL(url), 'utf8')),
);
const fetchImpl = async (url) =>
  new Response(readFileSync(new URL(url), 'utf8'));

test('the three actual snapshots retain every source and the documented counts', async () => {
  assert.deepEqual(
    packs.map((p) => p.length),
    [706, 4141, 121],
  );
  assert.equal(new Set(urls).size, 3);
  const { features, error } = await loadInfrastructureFeatures(urls, {
    fetchImpl,
  });
  assert.equal(error, null);
  assert.deepEqual(features, packs.flat());
  assert.equal(features.length, 4968);
  assert.equal(new Set(features.map((f) => f.id)).size, 4967);
  assert.deepEqual(
    features.filter((f) => f.id === -19953989).map((f) => f.geometry.type),
    ['Polygon', 'MultiLineString'],
  );
  const source = createInfrastructureSource({ fetchImpl });
  const records = await source.getRecords('local-dams');
  assert.equal(records.length, 4967);
  assert.equal(
    new Set(records.map((r) => `${r.source}:${r.sourceFeatureId}`)).size,
    4967,
  );
  assert.deepEqual(
    Object.fromEntries(
      ['OpenStreetMap / OpenInfraMap', 'NVE', 'IGN Argentina · Dique'].map(
        (name) => [name, records.filter((r) => r.source === name).length],
      ),
    ),
    {
      'OpenStreetMap / OpenInfraMap': 705,
      NVE: 4141,
      'IGN Argentina · Dique': 121,
    },
  );
  assert.deepEqual(
    features
      .filter((f) => !featurePoint(f))
      .map((f) => [f.id, f.geometry.type]),
    [[-19953989, 'MultiLineString']],
  );
  assert.equal(
    packs[1].filter((f) => f.properties.nve.damNumber === 4390).length,
    1,
  );
  for (const id of [262532166, -5671745])
    assert.equal(packs[0].filter((f) => f.id === id).length, 1);
  for (const id of [
    'ign-ar-dique-2578',
    'ign-ar-dique-2579',
    'ign-ar-dique-2956',
    'ign-ar-dique-2957',
  ])
    assert.ok(features.some((f) => f.id === id));
});

for (const failedIndex of [1, 2]) {
  test(`actual supplement ${failedIndex} failure preserves its sibling, then retries and caches the full set`, async () => {
    let failed = true;
    let requests = 0;
    const source = createInfrastructureSource({
      fetchImpl: (url) => {
        requests++;
        return failed && url === urls[failedIndex]
          ? Promise.resolve(new Response('', { status: 404 }))
          : fetchImpl(url);
      },
    });
    const partial = await source.getRecords('local-dams');
    assert.equal(partial.length, 4967 - packs[failedIndex].length);
    assert.equal(
      partial.filter((r) => r.source === 'OpenStreetMap / OpenInfraMap').length,
      705,
    );
    failed = false;
    const complete = await source.getRecords('local-dams');
    assert.equal(complete.length, 4967);
    assert.equal(requests, 6);
    assert.equal(await source.getRecords('local-dams'), complete);
    assert.equal(requests, 6);
  });
}

test('real NVE, IGN and OSM query results retain source identities after limiting', async () => {
  const infrastructure = createInfrastructureSource({ fetchImpl });
  const records = await infrastructure.getRecords('local-dams');
  const catalog = composeCatalog({
    tools: coreTools,
    services: { infrastructure },
  });
  for (const source of [
    'NVE',
    'IGN Argentina · Dique',
    'OpenStreetMap / OpenInfraMap',
  ]) {
    const target = records.find((r) => r.source === source);
    const result = await catalog.call('find_infrastructure', {
      kind: 'dams',
      area: { lat: target.lat, lon: target.lon, radius_km: 20 },
      limit: 1,
    });
    assert.equal(result.data.rows[0].source, source);
    assert.equal(result.data.rows[0].source_id, target.sourceFeatureId);
    assert.equal(result.data.attribution, target.attribution);
  }
  // Sparse fixture: source identity must survive absent optional register facts.
  const nve = {
    ...records.find((r) => r.source === 'NVE'),
    purpose: null,
    powerPlant: null,
  };
  const sparseCatalog = composeCatalog({
    tools: coreTools,
    services: { infrastructure: { getRecords: async () => [nve] } },
  });
  const result = await sparseCatalog.call('find_infrastructure', {
    kind: 'dams',
    area: { lat: nve.lat, lon: nve.lon, radius_km: 1 },
  });
  assert.equal(result.data.rows[0].source, 'NVE');
  assert.equal(result.data.rows[0].built, nve.built);
  assert.equal(result.data.rows[0].municipality, nve.municipality);
});

test('coincident NVE coordinates with different source identities remain separate for review', () => {
  const groups = new Map();
  for (const feature of packs[1]) {
    const key = feature.geometry.coordinates.join(',');
    const ids = groups.get(key) ?? [];
    ids.push(feature.id);
    groups.set(key, ids);
  }
  assert.equal(groups.size, 4137);
  assert.deepEqual(
    [...groups.values()].filter((ids) => ids.length > 1),
    [
      ['nve-dam-1000077', 'nve-dam-3506'],
      ['nve-dam-2523', 'nve-dam-8717'],
      ['nve-dam-5149', 'nve-dam-5150'],
      ['nve-dam-7029', 'nve-dam-p-59.01669-9.91040'],
    ],
  );
});
