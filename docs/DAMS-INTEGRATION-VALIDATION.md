# Dam integration verification — 2026-10-22

This verification branch combines three independently reviewable contributions.
It is not an upstream merge or a replacement PR for the NVE author's work.

## Inputs and published source fixes

| Input | Commit |
| --- | --- |
| Upstream main used for validation | `5d95e9adc496223a99a5b92de3b78f915bdf2f30` |
| #1009, trygvehhh, unchanged | `95c979908109d6c475db1ea948253dbccd719a3a` |
| #1152, radianx, corrected independent branch | `7298a265f3335917fbcdcac2ed009141467a6310` |
| #1149, radianx, corrected independent branch | `139bbc4a0d09030c8b164cc60bc886cc2b0194bc` |
| Combined code and regression tests | `d73ccd486cb3dc39766395b022927792fa8e5f5c` |

The combined commit has all three contribution heads as parents. Its tree is
`10d48f443a4da1c406d50f37f9e1144c347e5501`. Subsequent changes to this report
are documentation only. Node: 24.19.0.

## Data and behavior

- 706 OSM + 4,141 NVE + 121 IGN = **4,968 source features**, producing
  **4,967 query records** with unique `(source, sourceFeatureId)` identities.
- The original OSM relation 19953989 has Polygon and MultiLineString
  representations. Neither is overwritten; the query source returns its
  Polygon once. Cesium creates unique entities for the separate line parts.
- NVE's file and checksum are byte-identical to #1009. The OSM GeoJSON and
  GeoJSONL are byte-identical to #1152. IGN rebuilds to the same 121 additions;
  the combined audit updates its OSM input count from 704 to 706.
- `python scripts/build-dams-norway.py --verify` confirms 4,141 records and
  SHA-256 `1fa24e40949a37f31cd51e115c4d34d3c4f469f0787c3ce6915eb2a2cdc41ecc`.
- Existing acquisition deduplication remains intact, including NVE dam 4390
  and the two OSM/IGN overlaps. IGN's uncertain unnamed pairs and the four
  NVE coordinate-collision pairs remain separate and documented in
  [DAMS-INTEGRATION.md](DAMS-INTEGRATION.md). Their distinctness is not asserted.
- No OSM representative point is within 500 m of an NVE point. This distance
  check is not an authoritative identity survey.
- Source-specific query attribution, stable IDs, missing dates, sparse NVE
  facts, selected map contexts, repeated URLs, reversed completion order,
  failures of either supplement, retry/cache behavior and renderer recovery
  are covered. Empty and limit-one results credit only their returned sources.

## Test evidence

| Tree / run | Result |
| --- | --- |
| Combined full unit suite | 8,301 ordinary tests passed, 0 failed, 2 skipped; 15/15 allocation probes passed |
| Combined final focused set | 164/164 passed, including the later NVE coordinate-collision regression |
| #1149 final ordinary suite | 8,288 passed, 1 timing failure, 2 skipped |
| #1149 isolated rerun | Entire `analystEngine.test.mjs` passed 56/56 with unchanged budgets |
| #1149 final dam/source/renderer checks | 25/25 passed |
| #1152 ordinary suite | 8,277 passed, 0 failed, 2 skipped |
| #1152 focused infrastructure checks | 9/9 passed |
| #1152 allocation checks | Focus probe 1/1 passed; overlay probes 14/14 passed in an isolated run |

#1152 completed its ordinary plan and focus probe; the initial overlay-probe
process was interrupted and all 14 overlay probes then passed in an isolated
run. These are separate successful stages, not one uninterrupted `npm test`.

The #1149 failure was the 250k-row ranking timing assertion: the measured block
took 401 ms against its unchanged 400 ms budget during concurrent validation.
The isolated file then passed. This is a full ordinary run plus a targeted
rerun, not a claim of one clean full-suite run on that independent branch.
The combined full suite preceded a test/documentation-only addition; its final
focused rerun includes that addition and no runtime code changed afterwards.

Formatting, package boundaries, i18n, changelog, published layer-token ledger,
doctor and production build passed on both independent branches and the
combined candidate. #1149's build was repeated after its final runtime edit.
The combined i18n check includes the 24 NVE card strings added to the Chinese
locale introduced by current main; NVE's existing Spanish/Russian translations,
voice fields and schema pins are preserved.

## Remaining gates

The infrastructure browser gate could not launch Chromium: its required socket
was denied (`socket() failed: Operation not permitted`). The separate tracking
harness could not reach the dev-server process across the environment's isolated
sessions. These runs do not establish a browser pass or GPU performance result;
rerun `qa-infra-lod` and `test:track` in a browser-capable environment.

GitHub reports both radianx PRs as conflict-free with the checked main, but
hosted CI awaits maintainer authorization (`action_required`):

- [#1149 CI](https://github.com/bilawalsidhu/gods-eye-view/actions/runs/39882771669)
- [#1152 CI](https://github.com/bilawalsidhu/gods-eye-view/actions/runs/39882775063)

Recommended landing order: **#1009 → #1152 → #1149**. Reconcile the next
independent PR against the landed predecessors using the tested resolutions.
No changes were made to #1009, no review comments were posted to its author,
and nothing was merged into upstream main.
