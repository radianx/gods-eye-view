# SINARAME public viewer: integration research

Checked on 2026-10-15. This is research for an Argentine source on the existing Rain radar layer; it does not implement a new runtime source.

## Scope and sources

- Official entry and disclaimer: https://www.argentina.gob.ar/obras-publicas/recursos-hidricos/sistema-nacional-de-radares-meteorologicos-sinarame/imagenes
- Public viewer: https://radares.hidricosargentina.gob.ar/
- JavaScript observed through the viewer's import map: https://radares.hidricosargentina.gob.ar/js/radar.bwas0cb2os.js
- Anonymous PNG replay and initial mosaic evidence: https://github.com/radianx/gods-eye-view/actions/runs/38688277298

The research used Chromium/Puppeteer, public JavaScript, Node HTTP requests without a cookie jar or Authorization header, and PNG decoding. Probe code is in scripts/research-sinarame.mjs on the research/sinarame-viewer branch.

## Delivery architecture

The viewer is Blazor Server with Leaflet. Its observed connection uses /_blazor/negotiate and a /_blazor WebSocket. These are UI session endpoints, not a documented radar REST API.

The frontend's global radarState holds frame URLs and labels for an individual radar. createRadarOverlay draws L.imageOverlay(url, bounds). Mosaics combine individual radar overlays in the browser. The WMTS service at wms.ign.gob.ar is the IGN base map.

The selector lists 21 radar IDs (RMA1–RMA21). A listed radar is not proof that its current data are available. In this viewer, RMA13 is Ituzaingó and RMA5 is Bernardo de Irigoyen; use this viewer's mapping rather than older construction-stage numbering.

Observed frame path shape: /cache/{radarId}/{YYYYMMDDHHmmss}.png. The path shape does not establish a supported API or authorize inferring which timestamps exist. /cache/ and /cache/RMA13/ returned HTTP 404 rather than directory listings.

## Spatial and product meaning

Leaflet's map uses EPSG:3857. The public JavaScript computes image bounds around a radar center and radius:

- latitude offset = radiusKm / 110.574
- longitude offset = radiusKm / (111.32 * cos(latitude))

Observed coverage circles use 240 km. Those are the viewer's display bounds, not independently verified raster georeferencing. A source raster CRS/geotransform was not established.

Published marker coordinates:
- Ituzaingó / RMA13: latitude -27.6224, longitude -56.8417.
- Bernardo de Irigoyen / RMA5: latitude -26.2781, longitude -53.6708.

The viewer's legend spans -15 to 75 dBZ. This identifies reflectivity, not a numerical rainfall accumulation or forecast. The precise reflectivity product/vertical processing has not been verified.

## Verified HTTP image access

At approximately 05:43 UTC, both of these observed URLs returned HTTP 200 to a separate Node client with no cookies, Authorization, Origin or Referer:

- https://radares.hidricosargentina.gob.ar/cache/RMA1/20261015023000.png
- https://radares.hidricosargentina.gob.ar/cache/RMA2/20261015022000.png

Repeating both with Origin and Referer set to https://example.org also returned HTTP 200. Both were PNG, 512×512, with palette color type 3. Responses supplied ETag and Last-Modified; no Access-Control-Allow-Origin was present in the observed image responses. A successful HTTP request alone does not establish browser CORS permission.

The document returned X-Frame-Options: SAMEORIGIN and Content-Security-Policy: frame-ancestors 'self', preventing an external iframe embedding.

## Freshness and catalog discovery

An observed mosaic simultaneously contained RMA1 with filename time 02:30 and RMA2 with 02:20. A mosaic cannot be treated as one perfectly synchronized observation.

No separate JSON radar-frame manifest or radar WMS was found in the inspected public JavaScript and captured browser traffic. This is a bounded observation, not proof that the operator has no other service. The browser receives imagery metadata through the Blazor UI session.

Filename timestamps alone do not establish UTC offset. HTTP Last-Modified is cache/file metadata and must not substitute for observation time.

## NEA, history and decoded images

Final browser/HTTP evidence: https://github.com/radianx/gods-eye-view/actions/runs/38688995998
(research code commit c25bd9cbd88472f07af0673469a78d213298793f).

- Ituzaingó / RMA13 advertised six images with labels 15/10/2026 01:40:00 through 02:30:00, at ten-minute intervals.
- Bernardo de Irigoyen / RMA5 advertised the same six time slots.
- The latest Ituzaingó frame label was 02:30 while the viewer's last-update label was 02:51:14. Acquisition/refresh time is distinct from observation time.
- A completed mosaic displayed 19 loaded 512×512 images: RMA1–RMA18 and RMA20. RMA19 and RMA21 were in the selector but absent from this captured mosaic. The cause was not established.
- Mosaic filename times were 02:30 or 02:40 for most displayed radars, but 00:10 for RMA18. Presence in the mosaic does not establish freshness.
- One independent decoded frame for each NEA radar returned HTTP 200 without cookies/authentication, and again with foreign Origin/Referer:
  - RMA13 / 20261015023000.png: 10,178 bytes, 512×512, 254,777 transparent and 7,367 opaque pixels.
  - RMA5 / 20261015014000.png: 21,530 bytes, 512×512, 231,048 transparent and 31,096 opaque pixels.
- Both decoded images were inspected; they contain a transparent radar overlay rather than a complete map screenshot. No rainfall amount or severity is inferred from their colors here.

The final probe waited until all 21 marker objects were initialized before using selectors. An earlier attempt that changed selection during startup encountered a Blazor circuit exception. This establishes a readiness sensitivity in that test, not that either NEA radar was offline.

## Actual browser CORS test

A fresh page served from an independent localhost origin tested the observed Ituzaingó PNG:

| Operation | Result |
| --- | --- |
| Node fetch without a browser session | HTTP 200 |
| Node fetch with foreign Origin and Referer | HTTP 200 |
| Browser fetch with CORS | Failed to fetch |
| Plain HTML image | Loaded, 512×512 |
| Reading that image through canvas | Blocked (tainted canvas) |
| Image with crossOrigin=anonymous | Failed to load |

The public image host is therefore usable by a backend in this test, but direct cross-origin texture/image processing is unsuitable for Cesium. A same-origin image route or an upstream CORS change is needed.

## Reuse and support

The official landing page identifies the material as observations/processed radar products and states that it is not an official forecast or warning. The viewer credits EVARSA. No product-specific redistribution license, supported API contract, polling limit or availability guarantee was found in the inspected viewer/landing page.

Argentina.gob.ar's general content license should not automatically be extended to an externally hosted radar service. This research demonstrates technical accessibility, not an operator agreement. No operator was contacted.

## Implementation assessment

A prototype is technically feasible: an isolated browser collector can select a radar, read radarState.urls and frameTimestamps, and capture the overlay bounds. Once an actual image URL is known, a small backend fetches that PNG directly.

For a maintainable contribution to main, prefer a supported HTTP manifest from the operator containing radar IDs, available image URLs, observation times with explicit offsets, coverage bounds/CRS, product semantics and attribution. No such independent manifest was found in the observed flow.

A separate browser collector is a possible fallback, but adds session lifecycle handling, readiness waits and dependence on the viewer's internal UI contract. Keep that complexity out of the app's normal weather request handler.

A small first integration could cover RMA13 and RMA5 within the existing Rain radar layer. It would need:
1. A reliable frame-discovery mechanism and explicitly zoned observation timestamps.
2. A fixed-host, bounded same-origin PNG proxy/cache.
3. Preservation of the source legend and display georeferencing. The app's geographic WMS assumptions cannot be applied blindly to a PNG placed on a Web Mercator map; source projection still needs confirmation.
4. Separate freshness and missing-data states per radar. No synchronized national observation should be fabricated from asynchronous frames.
5. Confirmed product reuse terms and attribution.

The source offers a real contribution opportunity, but merely adding a URL to the existing NOAA WMS provider would not complete the integration.

## Reproducing the probe

The probe is diagnostic, not a scheduled downloader. It makes a bounded set of public UI selections, anonymous image requests and two directory-listing checks.

With Node 24 and a Chromium-compatible Linux environment:

```sh
npm install --prefix /tmp/sinarame-probe --no-audit --no-fund puppeteer@25.10.0 pngjs@7.0.0
node scripts/research-sinarame.mjs
```

The temporary Actions workflow used for this investigation is removed from the branch after recording the result. The JSON companion retains the curated source metadata and HTTP checks, without browser-session tokens or bundled images. Screenshots and raw probe artifacts are retained by the linked Actions run for seven days.

Limits: this was a short observation on 2026-10-15, not a long-running availability test. All 19 mosaic images loaded in the final browser snapshot; independent anonymous decoding/CORS checks covered the two NEA samples, not every radar and every historical frame. Frame discovery via the Blazor connection was exercised through a normal public browser session, not implemented as a standalone API client.
