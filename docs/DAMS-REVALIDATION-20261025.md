# Dams three-PR revalidation — 2026-10-25 (isolated checks)

## Exact input refs

- #1009 (trygvehhh): `524378b5737f2dd10160d8fc82f0f7693291a3d7`
- #1149 (radianx): `139bbc4a0d09030c8b164cc60bc886cc2b0194bc`
- #1152 (radianx): `7298a265f3335917fbcdcac2ed009141467a6310`
- Existing combined **runtime** snapshot: branch `integration/dams-1009-1152-1149-20261022`; its validation report pins #1009 at the **older** `95c979908109d6c475db1ea948253dbccd719a3a`.

**Scope warning:** This follow-up did NOT create or run a fresh Git merge of all three current PR commits. It executed the existing combined loader and query implementation with source datasets read directly from the three latest PR refs, plus direct checks on current #1009 card/locale code. It is **not** a fresh clean npm/CI/browser pass. The older combined full suite (8,301 ordinary pass, 15/15 allocation, 164/164 focused) is historical evidence only. Do not label the updated combination merge-tested or browser-validated.

## Results executed in this session

1. **23 isolated loader/data assertions PASS.** Loaded actual OSM GeoJSONL from #1152 (706 features), actual NVE GeoJSONL from #1009 (4,141), and actual IGN GeoJSONL from #1149 (121), using the exact `src/sources/infrastructureData.js` functions from the earlier combined candidate with mocked URL resolution and fetch transport. 4,968 total source features; **4,967 analyst records**: 705 OSM, 4,141 NVE, 121 IGN. All 4,967 have distinct `(source, sourceFeatureId)` combinations and non-empty attribution. The OSM relation `-19953989` has both Polygon and MultiLineString representations and is preserved. Confirmed NVE-specific facts, IGN snapshot retrieval date and null source-update date, and Acaray/Yacyretá records.
2. For independent HTTP 503 failures of **NVE** and **IGN**, the exact combined loader retains OSM and the healthy sibling; once the failed source recovers, it refetches all three, returns all 4,967 records, and caches only the complete result. OSM-main HTTP 404 remains fatal. NVE malformed GeoJSONL preserves the 827 good OSM+IGN features with an error. These tests ran with in-memory transport stubs, **not** a Cesium scene or network-error injection in a browser.
3. **21 isolated `find_infrastructure` assertions PASS.** Executed the exact earlier-combined query's `run` function with mocked geographic area services, ranking distance, and row capping; real 4,967 analyst records were supplied. Queries near NVE Stråtjerndammen, IGN Pueblo Viejo Derivador Los Reales, Acaray, and Yacyretá return the expected canonical source IDs and provenance. Norwegian purpose/type/municipality, IGN retrieval date/null update date, single-source attribution, empty-result null attribution, and one-row limit were checked. These are query-level tests; they do not test the full area resolver.
4. **8 source-geometry assertions PASS** on #1152 files. Its `dams.geojson` and `dams.geojsonl` each contain 706 identical features, in order. Acaray remains OSM way `262532166`, LineString, nine vertices, source version 7; Yacyretá-Apipé remains OSM relation `5671745` (runtime ID `-5671745`), Polygon, 116 vertices, version 2. This validates stored geometry and provenance, not Cesium rasterization or browser cards.
5. Re-evaluated `localInfrastructureOverlayCopy` from the latest #1009 commit and from the prior integration using an NVE mock feature; English and translated copy follow the same runtime shape, including NVE details. Confirmed all **28 NVE translation keys** in each latest #1009 locale file: `es`, `ru`, `zh-CN`. The existing integrated credits include NVE/NLOD, IGN and Open Infrastructure Map; its application service passes `t` to infrastructure cards.
6. The **Git blob SHA** of `norway.geojsonl` is identical between current #1009 and the existing integration (`89fda7daff2c1f37814b1c585eff7080cf157e35`). The `norway.sha256` file is also identical (`8011a8343eb965c6de0464a83897b052a10a4ea6`), recording content SHA-256 `1fa24e40949a37f31cd51e115c4d34d3c4f469f0787c3ce6915eb2a2cdc41ecc`. The prior checksum validation therefore applies to exactly the same bytes.

## Uncompleted / not established

- **Latest current-head Git integration:** #1009's 2026-10-23 merge brought a large set of newer `main` changes, whereas the verification branch is based on the earlier #1009 HEAD. No latest-current-head combined Git tree was created, merged, or compiled in this session. The isolated runtime tests above are informative but do not resolve that discrepancy.
- **Repository-level checks:** `npm test`, package/boundary/format/i18n checks, production build and allocation test suite were **not rerun** because no full Git checkout or npm dependencies were available; the container could not resolve `github.com` for cloning.
- **Browser / Cesium rendering:** The installed Chromium binary did not complete even a minimal headless DOM dump before the 12-second environment cutoff; a real God's Eye View dev server was unavailable. Cards, layer lifecycle, geometry rendering, click selection, memory on browser, and `qa-infra-lod` have **not** been browser revalidated.
- **Hosted workflows:** Latest #1009 GitHub CI shows success. The two radianx PR workflow runs show `action_required` (not a test failure); neither is evidence of fresh combined CI.

## Mutations and disposition

No runtime source, other author's PR branch, upstream `main`, or open PR head was modified. No reproducible defect was found in the scoped isolated checks; therefore no speculative fix was pushed to #1149 or #1152. This note is documentation-only on radianx's pre-existing **temporary integration** branch.

**Next required gate before claiming full compatibility:** Create a new temporary merge containing precisely the three current heads, reconcile shared files and upstream-main drift, run the full repository suite, build and allocated-memory probes on that tree, then run the Cesium/browser tests on a host able to launch the app. Keep all original PR branches independently reviewable.
