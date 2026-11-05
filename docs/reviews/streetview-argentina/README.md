# Street View cost protection × Argentina catalog

Review requested 2026-11-05. Executed on Node v24.22.1, Linux. These are mocked integration/characterization tests, not a production load test, live-camera availability check, browser/GPU playback claim, full-repository CI pass, or endorsement of every measured behavior.

## Frozen inputs and reproduction

| PR | Head | Patch extraction base |
|---|---|---|
| #1163 | `b92e91c2618cf46814c77b9273e1e83011fdcb2b` | regional integration baseline |
| #1588 | `906cc25233d91fb6a9bace6f74fe0ab570d01cd2` | `edd6212793c6adbfa30349af18fd530ee0aac3ba` |
| #666 | `63fbcf131b7143782e62c1fcb9aafba1888cee38` | `d48b9c4df9187dca0222b4cd8c91bd6bca60c085` |

From a checkout of this review branch, run:

```sh
node scripts/review/streetview/run.mjs
```

Requires Git and Node 24, no npm dependencies. The checkout must have the #1163 base commit above (a normal clone of this branch includes it). The runner makes two disposable detached worktrees from exactly #1163, applies the committed patches using `git apply --3way`, runs tests in separate Node processes, removes worktrees, and writes logs under `streetview-review-results/`. The preserved logs beside this report are the execution evidence.

The patches are the Street View runtime/helper/test deltas only, including #666's shared Google limiter extraction in `places/google-key.js` and `places/google.js`. They deliberately exclude unrelated history, documentation and build-security changes in the complete branches. There is no resolution hidden in the runner: both scoped integrations apply cleanly. Git verifies that the catalog, HLS stream, media and normalization files are unchanged from #1163. Original runtime attribution is retained by the pinned source PRs; the patches are review inputs, not a new competing implementation.

The new harness loads the actual Argentina JSON: 64 cameras (25 embed, 24 HLS, 15 image), replaces **all** `globalThis.fetch` calls without network passthrough, supplies a dummy Google key, and advances a fake clock. The existing selected relay and provider tests use their own fixtures. No billable service was called.

## Current policy, rather than stale PR prose

| Property | #1588 | #666 current code |
|---|---|---|
| Billable coordinates | Registered catalog only | Registered catalog only |
| Orientation | Registered catalog, normalized/clamped | Client orientation, normalized/clamped |
| Per-client allowance | None | 120/min/IP by default, shared with Places/geocoding |
| Aggregate backstop | 12 attempts/min/**plugin instance** | 2,400/min/process, shared Google limiter (`max * 20`) |
| Configuration | Constructor helper defaults; route does not expose env tuning | `GEV_RATELIMIT_GOOGLE_PER_MIN`; explicit 0 disables both limits |
| Reuse | None | 5-minute in-memory success cache, 64 entries, camera + normalized pose key |
| Concurrent identical misses | Each spends | Each spends; no pending-request coalescing |
| Google failure | Counts attempt | Counts attempt; not cached |
| Forwarded request | Synthetic; no Google | Synthetic; no cached Google or Google request |
| Original snapshot | Attempted before paid fallback | Attempted before cache and paid fallback |

The 240/client and 720/global figures still present in #666's older body do **not** describe its current head. Its shared cost limiter defaults to 120/IP and multiplies that by 20 for the aggregate backstop. #1588 describes its allowance as per-process, but `createStreetViewBudget()` is called inside `cctvProxy()`: two plugin instances in one process have independent allowances. Ordinary one-instance deployment still gets the intended 12/min behavior.

## Measured behavior

**#1163 + scoped #1588: 63/63 tests passed. #1163 + scoped #666: 76/76 passed. No skips/failures.** Each set includes ten new route/catalog characterization scenarios and the selected original catalog, external player, HLS/fMP4 admission, route, memory-bound and recovery tests. The counts overlap; they are two integration runs, not 139 distinct regressions.

| Mocked scenario | #1588 | #666 |
|---|---|---|
| All 15 still sources fail concurrently | 12 Google calls; 12 Street View + 3 synthetic | 15 Google calls; 15 Street View |
| Immediate same-camera refresh sweep | 0 additional calls; all 15 synthetic | 0 additional calls; all 15 cached Street View |
| Sweep after 60 seconds | 12 additional calls, total 24; still only 12 served | 0 additional calls, total 15; all 15 served |
| Original sources recover | All 15 immediately `upstream-image`; 0 extra Google | All 15 immediately `upstream-image`; 0 extra Google |
| Client A consumes own allowance with distinct poses; client B requests another camera | A spends 12, B gets synthetic | A spends 120, B gets Street View; total 121 |
| A recovers after exhausting its allowance | Original image still served | Original image still served |
| Many clients, unique uncached poses | Aggregate refusal after 12 | Aggregate refusal after 2,400 |
| Google returns 503 repeatedly, one client | Stops after 12 attempts | Stops after 120 attempts |
| Ten concurrent requests for same uncached camera/pose | 10 paid attempts | 10 paid attempts, despite success cache |
| A second plugin after first consumes allowance | Another Google call admitted (13 total) | Shared limiter refuses (120 total) |
| All 25 external players: frame and media requests | 50 HTTP 409, zero upstream/Google | Same |
| All 24 HLS stream descriptors | Existing media route retained; missing lease HTTP 400; no fetch | Same |
| Unknown camera / client coordinate override | Unknown synthetic/free; registered location unchanged | Same |

For the repeated outage sweeps the catalog order is stable. #1588 can repeatedly favor the first 12: a reset alone provides no fairness for the last three. The tests establish the immediate and one-minute cases; they do not claim a long-running production simulation.

HLS recovery evidence includes live-edge startup, expired old-404 recovery, strict recent-segment/access failures, init generation/discontinuity changes, bounded media/init/session storage, cancellation, leases and consumer expiry. Paid image fallback changes neither `stream.js` nor `media.js`. A deliberate `/frame/` request for an HLS camera without a working snapshot can still enter the existing Street View chain; normal `/media/` playback and recovery do not. The report does not imply HLS is categorically excluded from paid frame fallback.

## Concrete merge conflicts

Full-branch merge rehearsals used `git merge-tree --write-tree --name-only` (exit 1 means conflicts); raw outputs are committed beside this report.

* #1163 × #1588: `SECURITY.md`, `scripts/format-scope.json`, `scripts/package-boundaries.json`, and locale JSON for ar, de, fr, it, ja, pt, uk, zh-Hant. **`server/providers/cctv.js` auto-merges.** The differences brought by their upstream histories still require reconciliation.
* #1163 × #666: `build/vite.js`, `src/tooling/viteBuild.test.mjs`. **`server/providers/cctv.js` auto-merges.** Do not drop either branch's existing build-security deny entries while resolving.
* #1588 × #666: `SECURITY.md`, `build/vite.js`, **`server/providers/cctv.js`**, `src/tooling/viteBuild.test.mjs`. Both rewrite Street View admission and orientation. Consolidate them rather than stacking competing guards and accidentally charging two budgets or bypassing cache.

Commands after fetching the pinned PR refs:

```sh
git merge-tree --write-tree --name-only b92e91c2618cf46814c77b9273e1e83011fdcb2b 906cc25233d91fb6a9bace6f74fe0ab570d01cd2
git merge-tree --write-tree --name-only b92e91c2618cf46814c77b9273e1e83011fdcb2b 63fbcf131b7143782e62c1fcb9aafba1888cee38
git merge-tree --write-tree --name-only 906cc25233d91fb6a9bace6f74fe0ab570d01cd2 63fbcf131b7143782e62c1fcb9aafba1888cee38
```

## Recommendation to maintainers

Neither current policy is the final balance. #1588 is the stronger immediate spend brake; #666 offers materially better service for multiple cameras through reuse and client fairness. Do not replace 12/min blindly with #666's 2,400/min aggregate, and do not ship #666's image cache as automatically permissible merely because it is in memory for five minutes.

1. Preserve registered-camera-only coordinates, normalized finite pose, same-site/forwarded checks, external-player early rejection, and original-snapshot-first ordering. Prefer catalog-owned orientation for the fallback; arbitrary fractional client poses in #666 cheaply defeat cache reuse without moving the location.
2. Use a single process-owned admission service with separately configurable per-client and global budgets; debit actual new attempts, including failures, after free reuse/duplicate handling. Keep a non-disablable operator-selected global ceiling when a per-client limiter is disabled. IP fairness is only partial: clients behind one NAT share allowance, and multiple server processes need a shared ledger or divided allowances.
3. Size burst allowance to admitted distinct camera misses, not the 64 catalog entries. To serve all 15 static cameras for one client in one burst requires **at least 15** admissions at both levels. A configurable 16/client, 32/global per minute is a candidate for a deliberately low-spend two-viewer mode **only with per-camera cooldown/deduplication**; it is not a throughput claim for unrestricted 10-second polling. Without reuse/throttled fallback refresh, 15 cards × 6 refreshes require 90 new attempts/minute per viewer. Choose sustained limits from an operator's actual spend tolerance and observed demand.
4. Coalesce pending requests for the same canonical camera/pose **before** admission, bound concurrent tasks and response bytes, and add bounded per-camera retry cooldown/backoff after failure. A cached *success* alone does not stop the demonstrated ten-request burst or repeated Google failures. Continue original-source probes independently so cooldown, exhausted budgets and cached fallback never delay recovery.
5. Reuse of images needs a provider-permitted mechanism. Google's [Street View Static API policies](https://developers.google.com/maps/documentation/streetview/policies) explicitly identify panorama IDs as exempt from caching restrictions; they do not establish a general five-minute image-cache exception. [Service-specific terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) likewise describe ID caching. Verify the operator's applicable agreement before enabling any byte cache. If image reuse is not permitted, use admission cooldown and synthetic fallback instead of silently assuming RAM storage is exempt. The measured savings are an engineering result, not a license determination.
6. Add an operator-selected daily attempt ceiling/circuit breaker and observable low-cardinality counters for paid attempts, cache hits, coalesced requests and denials. A minute cap is a rate ceiling, not a daily spending budget: 12 attempts every minute still permits 17,280 attempted requests/day for one uninterrupted instance, and restarts/replicas complicate that further. These are attempts, not verified billable successes or a quoted currency cost.

For the existing PRs, consolidate the smallest catalog restriction and cost guard first, then add separately reviewable fairness, permitted reuse/deduplication and operational-budget changes. Keep the regional camera catalog and HLS relay unchanged; this review branch publishes reproducible evidence without selecting an unreviewed production policy for #1163.
