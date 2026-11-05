# Temporary integration: station weather and display units

Inputs (captured 2026-11-05):

- Upstream #1154: `2067eb01116e3149e35fcb1552cf127e5d527c82`.
- Upstream #1582: `dc11e340e7ff355dc817fdb0659bb8f6b22267d7`.
- Branch: `integration/1154-1582-weather-units` in radianx/gods-eye-view.

This is a merge of those exact heads. It preserves both histories and the upstream changes already carried by them. It does not update either original PR branch or claim compatibility with newer upstream commits.

## Actual merge conflicts

| File | Resolution |
| --- | --- |
| `src/ui/cockpitBriefing.js` | Preserve #1154's `renderLocalWeather`, station validity, independent clocks and source attribution. Move #1582's conversions into that renderer; remove its duplicate weather fields from `renderRegionalBrief`. |
| `src/i18n/locales/ar.json` | Keep both station messages and the units-selector messages. |
| `src/i18n/same-as-english.json` | Combine additive allowances without duplicates. Add the German unit-independent wind phrase, which is identical to English. |

`CockpitBriefing.vue` and the controller merge without textual conflicts. Their existing reactive precipitation label and unit-change subscription are retained.

## Minimal compatibility change

Use `formatCockpitTemperature` for the main SMN/model temperature and `formatMeasure` for DMH temperature, both winds and both station distances. Use `convertQuantity` for the numeric precipitation field, whose unit is rendered separately by Vue (one decimal for mm, two for inches). No new conversion formulas or unit state are introduced.

Three station translation keys now accept complete quantities rather than attaching KM or KM/H themselves, in all eleven non-English catalogs. Existing regression and offline QA expectations accept the shared formatters' nonbreaking space.

The existing controller unit-change event re-renders the cached regional payload. Providers, caches, observations, timestamps, coverage/expiry rules and AI tool runtime contracts are unchanged. Source fields remain Celsius, km/h, mm and metres/km as specified by their existing contracts. Neither SMN nor DMH is assigned a precipitation observation it did not publish; an absent value stays unknown. DMH missing readings are omitted; main-card missing readings display an em dash. Zero is preserved.

## Verification

- 137 focused tests passed: cockpit renderer and Vue/controller integration, shared units and surface tests, both regional providers, regional requests and AI environment queries.
- The mounted Vue test uses the real controller subscription and application reactive unit preference. Three round trips verify temperatures, wind, both station distances, precipitation value/label, immediate publication, and unchanged frozen input data.
- Unknown/nonfinite readings and valid zero readings are checked under both systems. Existing multilingual tests retain provider provenance, independent expiry, escaping and clearing.
- The AI regression runs under imperial display and verifies original SI temperature, wind, precipitation, SMN distance, DMH payload and independent source clocks.
- Production build, format (1,766 files), translations, import/package boundaries (1,147 modules, 86 portable entries), changelog validation and layer-token validation passed.
- Catalog regression rerun after staging conflict resolutions: 23 passed. The first general run began with unmerged index entries, causing its locale inventory assertion to count Arabic multiple times; this is an index-state test artifact.

Final clean `npm test` on Node 24.22.1/Linux: **10,551 ordinary tests passed, zero failed, two platform/environment skips; all 15 isolated allocation probes passed**. The ordinary pass took 119.8 seconds; the two allocation files ran serially with GC enabled. The final runtime/test files are the same files used for this clean pass.

Live provider availability and the full graphical/GPU cockpit/tracking browser gates are outside this validation; the mounted UI regression runs in happy-dom.
