import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { firmsProxy } from './firms.js';
import { adaptFirmsRecords } from '../../src/data/firmsAdapt.js';
import { fireDetectionKey } from '../../src/data/firmsLabels.js';
import { filterFires } from '../../src/data/firmsIntensity.js';
import { composeCatalog } from '../../src/tools/catalog.js';
import { getActiveFires } from '../../src/tools/queries/hazards.js';
import { createModel } from '../../src/layers/firms/model.js';
import { createQueries } from '../../src/layers/firms/queries.js';

const NOW = Date.parse('2026-11-05T06:00:00Z');
const listing =
  'https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/10min/';
const file = 'focos_10min_20261105_0550.csv';

function setup(t, { key = '', conae = '1', inpe = '' } = {}) {
  for (const [name, value] of Object.entries({
    FIRMS_MAP_KEY: key,
    CONAE_GOES_ENABLED: conae,
    FIRMS_INPE_ENABLED: inpe,
  })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() =>
      previous === undefined
        ? delete process.env[name]
        : (process.env[name] = previous),
    );
  }
  const control = { now: NOW, fail: new Set(), calls: [] };
  t.mock.method(Date, 'now', () => control.now);
  t.mock.method(console, 'warn', () => {});
  t.mock.method(fs, 'readFile', async () => {
    throw Error('no cache');
  });
  t.mock.method(fs, 'mkdir', async () => {});
  t.mock.method(fs, 'writeFile', async () => {});
  t.mock.method(globalThis, 'fetch', async (raw) => {
    const url = String(raw);
    const provider = url.startsWith(listing)
      ? 'inpe'
      : url.includes('geoservicios.conae.gov.ar')
        ? 'conae'
        : 'firms';
    control.calls.push({ provider, url });
    if (control.fail.has(provider) || control.fail.has(url))
      throw Error('offline');
    if (url === listing) return new Response(`<a href="${file}">${file}</a>`);
    if (url === listing + file)
      return new Response(
        'lat,lon,satelite,data\n-30,-60,GOES-19,2026-11-05 05:50:00\n-30,-60,GOES-19,2026-11-05 05:40:00\n',
      );
    if (provider === 'conae')
      return Response.json({
        type: 'FeatureCollection',
        features: [null, 0].map((frp, i) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-60, -30] },
          properties: {
            'Fecha_Local_UTC-3': `2026-11-05 02:${i === 0 ? '50' : '40'}:00`,
            Satelite: 'GOES19',
            Fire_Radiative_Power: frp,
          },
        })),
      });
    if (url.includes('mapkey_status'))
      return Response.json({
        current_transactions: 3,
        transaction_limit: 5000,
      });
    return new Response(
      'latitude,longitude,acq_date,acq_time,confidence,frp\n-30,-60,2026-11-05,0550,n,12\n',
    );
  });
  let handler;
  firmsProxy().configureServer({
    middlewares: {
      use: (_, fn) => {
        handler = fn;
      },
    },
  });
  control.request = async (url = '/') => {
    let status, body;
    await handler(
      { url },
      {
        headersSent: false,
        writeHead(code) {
          status = code;
          this.headersSent = true;
        },
        end(text) {
          body = JSON.parse(text);
        },
      },
    );
    return { status, body };
  };
  return control;
}

test('provider selection matrix preserves NASA defaults and supports independent keyless sources', async (t) => {
  for (const key of ['', 'fixture-key'])
    for (const conae of ['', '1'])
      for (const inpe of ['', '0', '1']) {
        await t.test(
          `${key ? 'NASA' : 'keyless'} CONAE=${conae || 'off'} INPE=${inpe || 'default'}`,
          async (t) => {
            const app = setup(t, { key, conae, inpe });
            const activeInpe = inpe === '1' || (!key && inpe !== '0');
            const count =
              (key ? 3 : 0) + (conae ? 2 : 0) + (activeInpe ? 2 : 0);
            await app.request('/status');
            assert.equal(
              app.calls.length,
              key ? 1 : 0,
              'keyless status never acquires data',
            );
            const responses = await Promise.all([app.request(), app.request()]);
            for (const { status, body } of responses) {
              assert.equal(status, count ? 200 : 503);
              if (count) {
                assert.equal(body.count, count);
                assert.equal(
                  body.sources.length,
                  (key ? 3 : 0) + (conae ? 1 : 0) + (activeInpe ? 1 : 0),
                );
                assert.equal(body.coverage === 'world', !!key);
                assert.equal(body.sourceLabel.includes('CONAE'), !!conae);
                assert.equal(body.sourceLabel.includes('INPE'), activeInpe);
              }
            }
            assert.equal(
              app.calls.filter((c) => c.provider === 'inpe').length,
              activeInpe ? 2 : 0,
            );
            assert.equal(
              app.calls.filter((c) => c.provider === 'conae').length,
              conae ? 1 : 0,
            );
            assert.equal(
              app.calls.filter(
                (c) =>
                  c.provider === 'firms' && !c.url.includes('mapkey_status'),
              ).length,
              key ? 3 : 0,
            );
            await app.request();
            assert.equal((await app.request('/status')).body.hasKey, !!key);
          },
        );
      }
});

test('one failed regional provider preserves the other; total failure returns 502 and recovers', async (t) => {
  for (const failed of [['inpe'], ['conae'], ['inpe', 'conae']])
    await t.test(failed.join('+'), async (t) => {
      const app = setup(t);
      app.fail = new Set(failed);
      const { status, body } = await app.request();
      assert.equal(status, failed.length === 2 ? 502 : 200);
      assert.equal(
        body.sources.filter((s) => s.ok === false).length,
        failed.length,
      );
      if (status === 200) {
        assert.equal(body.count, 2);
        assert.notEqual(body.coverage, 'world');
      }
      app.fail.clear();
      app.now += 61_000;
      const recovered = await app.request();
      assert.equal(recovered.status, 200);
      assert.equal(recovered.body.count, 4);
    });
});

test('independent cache expiry, stale health, 24h pruning and recovery', async (t) => {
  const app = setup(t, { key: 'fixture-key', inpe: '1' });
  await app.request();
  app.now += 11 * 60_000;
  app.fail.add('inpe');
  const stale = (await app.request()).body;
  assert.equal(stale.stale, true);
  assert.equal(stale.count, 7);
  assert.equal(
    stale.sources.find((s) => s.source === 'INPE_QUEIMADAS').ok,
    false,
  );
  assert.equal(stale.providers.find((p) => p.provider === 'inpe').stale, true);
  assert.equal(
    app.calls.filter((c) => c.provider === 'firms').length,
    3,
    'regional refresh does not spend NASA quota',
  );
  assert.equal(app.calls.filter((c) => c.provider === 'conae').length, 2);
  const previousCalls = app.calls.length;
  await app.request();
  assert.equal(
    app.calls.length,
    previousCalls,
    'failed INPE listing backs off',
  );
  app.fail.clear();
  app.now += 61_000;
  assert.equal((await app.request()).body.stale, false);
  app.now += 25 * 3600_000;
  app.fail = new Set(['firms', 'inpe', 'conae']);
  const expired = (await app.request()).body;
  assert.equal(expired.stale, true);
  assert.equal(
    expired.count,
    0,
    'stale caches cannot extend observation windows',
  );
  assert.equal(expired.sources.filter((s) => s.ok === false).length >= 2, true);
});

test('INPE file failure is partial coverage even while CONAE succeeds', async (t) => {
  const app = setup(t);
  app.fail.add(listing + file);
  const { status, body } = await app.request();
  assert.equal(status, 200);
  assert.equal(body.sourceLabel, 'CONAE GOES');
  assert.equal(
    body.sources.find((s) => s.source === 'INPE Programa Queimadas').ok,
    false,
  );
});

test('GOES-19 overlap retains both provenances and acquisitions through layer, filters and tool', async (t) => {
  const app = setup(t);
  const snapshot = (await app.request()).body;
  const records = adaptFirmsRecords(snapshot.fires);
  assert.equal(
    records.length,
    4,
    'coincident coordinates and times are retained',
  );
  assert.equal(new Set(records.map(fireDetectionKey)).size, 4);
  assert.equal(records.filter((f) => f.frp === null).length, 3);
  assert.ok(
    records.every((f) => f.confidence === null && f.brightness === null),
  );
  const model = createModel({
    layerState: {},
    services: { anchors: { fireAnchorHeight: () => 0 } },
  });
  for (const fire of records) {
    assert.match(model.mapAnalystRecord(fire).source, /INPE|CONAE/);
    assert.doesNotMatch(model.detectionLabel(fire), /NaN/);
    if (fire.frp === null) {
      assert.doesNotMatch(model.detectionLabel(fire), /0\.0 MW/);
      assert.equal(model.detectionColorStop(fire).name, 'unknown');
    }
  }
  assert.equal(filterFires(records).length, 4);
  const unknownOnly = createQueries({
    layerState: { _firesByFrp: records.filter((f) => f.frp === null) },
    components: { model },
    config: {},
  }).methods;
  assert.equal(
    unknownOnly.getStrongestFire(),
    null,
    'unknown FRP cannot identify a strongest fire',
  );
  assert.equal(
    filterFires(records, { minFrp: 1, confidence: 'all' }).length,
    0,
  );
  assert.equal(
    filterFires(records, { minFrp: 0, confidence: 'nominal' }).length,
    0,
  );
  const tools = composeCatalog({
    tools: [getActiveFires],
    services: { fires: { getSnapshot: async () => snapshot } },
  });
  const area = { bbox: [-65, -35, -55, -25] };
  const { data, summary } = await tools.call('get_active_fires', { area });
  assert.equal(data.rows.length, 4);
  assert.equal(
    data.rows[0].frp_mw,
    0,
    'a measured zero ranks before unknown FRP',
  );
  assert.deepEqual(
    new Set(data.rows.map((r) => r.source)),
    new Set(['INPE Programa Queimadas', 'CONAE GOES']),
  );
  assert.equal(data.coverage, 'regional');
  assert.match(summary, /regional coverage/);
  assert.ok(data.rows.every((r) => r.acquired && r.confidence === null));
  for (const args of [{ min_frp_mw: 1 }, { confidence: 'high' }]) {
    const result = await tools.call('get_active_fires', { area, ...args });
    assert.deepEqual(result.data.rows, []);
  }
});
