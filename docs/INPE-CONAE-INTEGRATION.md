# Temporary INPE + CONAE integration

Prepared 2026-11-05. This branch combines upstream PR #1573 at
`76b1da17d335da052de2473fd00409a51bcdc29e` and PR #1146 at
`a8092319a253a4e226acc6225c945225c2b71103`. It is a compatibility experiment;
neither original contribution is replaced. The already-published NASA Suomi NPP
retirement adaptation is retained, not repeated as new work.

## Provider selection

`CONAE_GOES_ENABLED=1` is always an independent opt-in.

| NASA key | FIRMS_INPE_ENABLED | Providers, plus optional CONAE |
| --- | --- | --- |
| Present | Unset/empty | NASA FIRMS |
| Present | 0 | NASA FIRMS |
| Present | 1 | NASA FIRMS + INPE |
| Absent | Unset/empty or 1 | INPE |
| Absent | 0 | CONAE alone if enabled; otherwise 503 `no_key` |

For keyless simultaneous observations:

```sh
CONAE_GOES_ENABLED=1
# Leave FIRMS_MAP_KEY unset and FIRMS_INPE_ENABLED unset, or set it to 1.
```

NASA keeps its sequential three-source acquisition, 30-minute memory/disk cache
and transaction accounting. INPE keeps its 10-minute snapshot and per-file cache;
CONAE keeps its 10-minute memory cache. Each has its own single-flight promise.
INPE and CONAE have independent 60-second failure backoff. Regional refreshes
do not invalidate or spend NASA quota. A failed provider does not erase another
provider's observations. Last-good snapshots are served with stale state;
providers with no usable cache are marked failed in `sources`. If all enabled
providers fail without cache, the response is 502, not a healthy empty feed.
Each provider prunes observations against its own existing 24-hour policy at
serve time; a stale snapshot cannot extend that window. CONAE retains its
existing ten-minute future-clock tolerance.

## Provenance, coverage and unknown values

Responses include the actual `sourceLabel`, aggregate `coverage`, and a
`providers` array with coverage, freshness, acquisition time and partial state.
`world` describes the NASA product's sampling extent, not complete ground
coverage. INPE alone reports `south-america`; CONAE alone reports
`conae-product-footprint`, deliberately avoiding an unverified geographic bound.
The regional combination reports `regional`, with each footprint retained in
`providers`. If NASA fails without a usable cache, regional survivors cannot
claim world coverage. `/status` is observational for regional providers and
`hasKey` continues to mean NASA credentials only.

INPE's CSV supplies no FRP, confidence or brightness; these remain `null` in
the API, adapter, analyst records and tool. CONAE retains FRP only when actually
published; confidence and brightness remain unknown. Source names remain distinct
in cards, selection context and `get_active_fires` rows. GOES-19's INPE `G19`
code is normalized for display without changing its raw acquisition record.

Default filters retain unknown values. A positive minimum FRP excludes unknown
FRP; nominal/high confidence excludes unknown confidence. The tool and layer
use the same predicate without `Number(null)` coercion. Measured zero ranks
before unknown FRP; the strongest-fire query returns null for an unknown-only
set. Unknown marker/card intensity uses a neutral gray outside the measured
FRP ramp, not an invented mid-ramp measurement.

The inherited far-distance heat raster still uses its 0.5 minimum visualization
weight for null or zero FRP. **This is not a 0.5 MW measurement.** Its colors
show a visualization of weighted observations, not a calibrated map of radiated
power when unknown-FRP providers are included. Neither API nor tool substitutes
that drawing weight for FRP. Redesigning the heat raster is outside this
temporary integration; observation counts and heat can include overlapping
provider reports.

## GOES-19 overlap and deduplication policy

The source contracts establish a possible overlap, not an empirical duplicate
rate. INPE identifies satellite, position and UTC pass time to the minute in
its normalized record. CONAE supplies GOES satellite, position, a UTC-3 timestamp
converted to epoch milliseconds (retaining seconds), and optional FRP. Neither
normalized product exposes a shared ABI scan/product/pixel identifier or an
established processing lineage linking the two agencies' observations.

The integration therefore **does not deduplicate across providers**, including
exact coordinate/time matches. Coincident reports can be correlated observations
of the same event, repeated scans, distinct pixels or different algorithms.
Removing one would lose provenance and could discard the only published FRP.
No distance radius, coordinate rounding or time window authorizes deletion.
Identity includes provider, satellite, acquisition and position for selection;
it is not used to deduplicate the response. Refetching replaces each provider's
snapshot rather than appending it to previous snapshots.

Future policy: collapse only proven retransmissions within a provider using its
stable upstream observation/product ID, preserving attribution. Across agencies,
retain the original rows and optionally create a non-destructive association
group when a shared scan/product/pixel ID and compatible processing versions
establish common lineage. Retain all FRP/confidence values separately rather
than choosing an arbitrary winner. A geographic/temporal association alone can
label a candidate for review, never delete it. Counts in this branch are
**provider observations, not unique wildfire incidents**; `get_active_fires`
includes that statement in its result contract.

## Validation and limits

Node 24.22.1 on Linux. The focused integration plan covers provider selection
with/without a NASA key, CONAE on/off, INPE default/0/1, concurrent clients,
independent expiry/quota behavior, one-provider/total failure and recovery,
stale re-filtering, failed INPE files, coincident GOES-19 observations, unknown
measurements through layer/tool consumers, intensity filters and missing-source
reporting. Existing parser/cache/card/interaction/heat/source/i18n/tool tests
are retained; only expectations whose contracts changed are adapted.

Results: **274 focused tests passed**, zero failures/skips; **68 tool/voice/
first-run contract checks passed**, zero failures/skips. Production build,
all eleven locale catalogs, formatting, changelog validation and import/package
boundaries passed separately. The production build's large-chunk warning is
informational. The final published tree is recorded in the review description.

No live NASA/INPE/CONAE acquisition, paired real-observation sample, empirical
overlap estimate, browser/GPU gate, fresh full-unit-suite run, or hosted CI
success is claimed. Initial INPE cache fill retains #1573's multi-file network
cost and per-request timeout design; this branch does not certify production
latency or regional source uptime. The pinned inputs may diverge from later PR
updates or main.

Sources: [INPE PR #1573](https://github.com/bilawalsidhu/gods-eye-view/pull/1573),
[CONAE PR #1146](https://github.com/bilawalsidhu/gods-eye-view/pull/1146),
[INPE CSV directory](https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/10min/),
[CONAE source notes](CONAE-GOES.md). Overlap conclusions above are inferences
from the pinned source contracts and synthetic integration tests, not a live
cross-provider validation.
