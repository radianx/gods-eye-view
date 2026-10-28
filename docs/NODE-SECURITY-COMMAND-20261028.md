# COMMAND / Node security integration — 2026-10-28

## Result and scope

No reproducible COMMAND incompatibility was found when moving from Node
24.14.0 to 24.22.1 in the checks below. This is local Linux validation with
synthetic credentials and scripted model responses, not a live-account or
hosted-CI certification.

Integration branch: `radianx:integration/check-1331-1458-20261028`.

- COMMAND baseline: #1331 head `9f2b2c5ccd01d2045f5d73306f6a083c30f4ca03`,
  tree `8cd1e4b39da68df9abd19bccaf3ba9d2d90b36a6`.
- Security source: anobjectn's #1458 head
  `17d0877a4cedf1b44b9ce8f0927654ef5436390d`, comprising
  `2a335a8f3560ab16bc4fe5cd4956939def32ad46` and
  `17d0877a4cedf1b44b9ce8f0927654ef5436390d`.
- Both security commits applied cleanly. Their six-file patch is preserved,
  including the exact Docker digest and changelog attribution. No other
  upstream-main changes were incorporated for this experiment.
- Only this temporary branch carries the security patch, this report and the
  reproducible runtime probe. No fix was necessary in #1331, so its branch was
  left unchanged. anobjectn's branch and PR were not modified.

The older-runtime control used an isolated worktree of the exact #1331 head;
its install, ordinary suite, allocation checks and build run on Node 24.14.0.
The combined tree runs on 24.22.1. Focused tests, the runtime probe and browser
console fixtures also ran with both runtimes against the combined application
code; the six security files do not change that code.

## Results

| Check                                                         | Node 24.14.0 control               | Node 24.22.1 integration           |
| ------------------------------------------------------------- | ---------------------------------- | ---------------------------------- |
| Fresh `PUPPETEER_SKIP_DOWNLOAD=1 npm ci --no-audit --no-fund` | Passed, 174 packages               | Passed, 174 packages               |
| Ordinary full test plan, four workers                         | 9,206 passed, 10 skipped, 0 failed | 9,206 passed, 10 skipped, 0 failed |
| Serialized GC allocation checks                               | PENDING                            | 15 passed, 0 skipped, 0 failed     |
| Production `npm run build`                                    | PENDING                            | Passed                             |
| Focused ChatGPT, credential, Codex and agent tests            | 397 passed, 8 skipped, 0 failed    | 397 passed, 8 skipped, 0 failed    |
| Real HTTP/fetch runtime probe                                 | All 8 checks passed                | All 8 checks passed                |
| Browser console fixtures, 6 locales × 2 sizes                 | All 12 passed                      | All 12 passed                      |
| Rendered Cesium / real action runner camera gate              | Passed                             | Passed                             |
| Built full-application console, ChatGPT selected, offline     | Not repeated                       | Passed                             |

Focused suites cover signed fixture JWTs, PKCE/state/nonce, invalid grants and
claims, callback replay and cancellation, rotating refresh credentials,
concurrent stores, private/atomic storage, account binding and logout,
same-site/loopback and proxy/Host denial, endpoint registration on development
and preview, rate limiting, body bounds, failed/partial SSE, tool schemas,
command/result history, STOP and queued-action cancellation. They use temporary
stores, synthetic access/refresh tokens, generated RSA keys and fixture models.
No real token was read or sent, and no paid inference was requested.

The eight focused skips are five native-Windows credential tests and three
conditional right-rail integration tests: this #1331 tree has no
`src/ui/rightRailTabs.js`. The full suite retains the same ten skips under both
runtimes, including the additional platform-conditional tests. Skips were not
converted into passes or disabled to make this comparison succeed.

`qa-agent-chatgpt.mjs` uses the real template, controller, styles and translations
with fixture responses: tool/result rounds, account isolation, STOP, logout,
pending login copy and layout. `qa-agent-camera.mjs` renders Cesium and measures
rotation, direction/speed changes, explicit stop, navigation, framing refusal,
fresh reset and failed-reset blocking. Model replies remain scripted.

The built application's offline gate checks actual config/model routing,
mount/open, pickers, positioning, drag/resize, persistence and teardown. Its
initial unconfigured Ollama model request returns 502; the gate then selects
ChatGPT and skips inference as designed. This is not a successful model call.

## Runtime-sensitive behavior and CI

Observed runtime components:

| Component | 24.14.0             | 24.22.1             |
| --------- | ------------------- | ------------------- |
| OpenSSL   | 3.5.5               | 3.5.9               |
| Undici    | 7.21.0              | 7.30.1              |
| V8        | 13.6.233.17-node.41 | 13.6.233.17-node.58 |

The Node release notes describe DNS/TLS hardening, Brotli and HTTP fixes, plus
OpenSSL, CA and Undici updates. COMMAND uses fixed canonical HTTPS OpenAI
origins, the built-in fetch, bounded stream readers and canonical loopback OAuth
callbacks. Those are relevant review points; changing the runtime does not
justify weakening any origin, redirect, TLS or stream check.

The added `scripts/qa-node-security-compat.mjs` exercises actual Node HTTP sockets
and fetch, not a mocked Response alone. It verifies gzip and Brotli JSON;
redirect refusal; a real HTTP command → Brotli SSE → validated application
action → tool-result round trip; denial of foreign-Origin and forwarded
requests before inference; rejection of incomplete streams; aborting a pending
fetch stream; and canonical loopback TLS identity checks requiring an IP SAN.
The upstream URL is redirected only inside the test transport to a local fixture
server. No external provider receives the synthetic bearer token.

Both runtimes produced identical passing outcomes in this probe. It does not
send exploit payloads, test every CVE, verify a real OpenAI certificate chain or
measure production DNS/TLS behavior. The fixed runtime supplies the security
fixes; these checks establish bounded application compatibility.

Static assertions passed for all of the following:

- Verify matrix: `[24.22.1, 26.x]`.
- `GEV_REQUIRE_ALLOCATION_GATE` compares the string `24.22.1`, so the pinned
  job still requires the allocation gate. The runner calibrates by major 24,
  and all 15 real allocation checks passed on the patched runtime.
- The Street Level and Windows jobs pin `24.22.1`; the native Windows ChatGPT
  credential-storage step added by #1331 remains present.
- Docker retains anobjectn's exact pin:
  `node:24.22.1-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c`.

`package.json` and `package-lock.json` are byte-identical to #1331. Lockfile
SHA-256: `50109205ccb0612cd10d97d6c5988a9b0959279352057cab2a7de6a2572931d3`.
As proposed in #1458, the engines floor and doctor's minimum remain 24.14.0;
they do not enforce the security minimum. `26.x` is floating and was not run in
this local comparison. No extra Node bump was added to #1331.

## Other checks and remaining security findings

On the integration: formatting (including the new probe), import/package
boundaries, i18n (2,759 complete messages each for es/ru/zh-CN/zh-Hant), setup
doctor (`ready: true`), layer tokens (32 published, zero new against #1331) and
changelog validation passed. Production build retains the large-chunk warning.

`npm audit --json` exits nonzero with five high-severity dependency entries:
`vite` 6.4.3, `puppeteer` 25.10.0, `puppeteer-core` 25.10.0,
`chromium-bidi` 17.0.2 and its nested `zod` 3.25.76. These are five affected
package entries, not five independent vulnerabilities. The report includes
launch-editor/Windows and other Vite advisories, and the transitive Zod
oversized-collection issue (GHSA-mrhx-c7xc-m3w5).

`npm audit --omit=dev --json` reports zero vulnerabilities. These audit outputs
do not cover Node's bundled libraries. The full development dependency audit
is not clean. Since neither package manifest nor lockfile changes in #1458,
these findings predate this integration and are not a COMMAND/Node regression.
They require a separate dependency review; no broad `npm audit fix` was applied.

## Limits and upstream dependencies

- #1458 was open and unmerged when inspected. This temporary branch does not
  update upstream main, radianx/main or an existing deployment.
- After #1458 lands upstream, reconcile #1331 with that actual merged revision,
  remove the need for temporary security cherry-picks and rerun CI. Preserve
  upstream's final Docker structure/digest and all Node-pinned job conditions;
  concurrent Docker changes may require reconciliation.
- #1331 remains a draft with its existing #976 stacking/release requirements.
- Live eligible-account sign-in, discovery, inference, refresh, limits and
  revocation are not certified. Synthetic credentials cannot establish account
  eligibility, live TLS/provider interoperability or model semantics.
- Native Windows DACL/ownership and second-user verification remain unexecuted
  on this Linux host. No hosted GitHub Actions run was triggered or certified.
- No Docker daemon/CLI is available, so image build, container execution and
  registry digest resolution were not independently tested here. The proposed
  pin was preserved exactly, not replaced with an unverified alternative.
- Standard Chromium failed before page load because Unix socket creation was
  denied. Chromium Headless Shell 159.0.8129.0 successfully ran the browser
  gates with software rendering. This does not certify physical GPUs, Windows,
  microphone/audio or the broad tracking/graphics release gate. The known
  load-sensitive tracking battery and adjacent voice-panel browser gate were
  not rerun in this security-focused exercise.
- No conclusion is drawn about the Node version of any existing deployment.

## Reproduction

Select Node 24.22.1 for the integration branch; use 24.14.0 only in an isolated
local control worktree. The older binary was downloaded from nodejs.org and
matched its published SHASUMS256 entry. npm was 11.9.0 in both environments.

```sh
PUPPETEER_SKIP_DOWNLOAD=1 npm ci --no-audit --no-fund
node --test --test-concurrency=4 server/providers/agent/chatgpt/*.test.mjs \
  server/providers/common/credential-file.test.mjs \
  src/codexOauthRealtime.test.mjs src/agent/*.test.mjs
node scripts/qa-node-security-compat.mjs
npm run build
npm run format:check
npm run check:boundaries
npm run i18n
npm run doctor -- --json
npm run changelog:check
npm run layer-token:check -- --base-ref 9f2b2c5ccd01d2045f5d73306f6a083c30f4ca03
npm audit --json
npm audit --omit=dev --json
```

The complete suite uses the repository's exact discovered test plan with four
workers instead of default machine concurrency; the allocation files then run
separately, serialized, with GC exposed. No budgets or deadlines were changed:

```sh
GEV_REQUIRE_ALLOCATION_GATE=1 node --input-type=module -e '
import { spawnSync } from "node:child_process";
import { buildUnitTestPlan, discoverUnitTestFiles, allocationTestArgs }
  from "./scripts/run-unit-tests.mjs";
const plan = buildUnitTestPlan(discoverUnitTestFiles());
for (const args of [
  ["--test", "--test-concurrency=4", ...plan.parallel],
  ...plan.serializedAllocations.map(allocationTestArgs),
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit", env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}'
```

With `PUPPETEER_EXECUTABLE_PATH` pointing to a working Headless Shell:

```sh
node scripts/qa-agent-chatgpt.mjs
node scripts/qa-agent-camera.mjs
# Start preview and run the next command in the same network namespace:
npm run preview -- --host 127.0.0.1 --port 4188 --strictPort
# In a shell sharing that server's network namespace:
node scripts/qa-agent-console.mjs --url http://127.0.0.1:4188 --provider chatgpt --offline
```

Sources: [#1331](https://github.com/bilawalsidhu/gods-eye-view/pull/1331),
[#1458](https://github.com/bilawalsidhu/gods-eye-view/pull/1458),
[Node 24.22.1 release](https://nodejs.org/en/blog/release/v24.22.1),
[October security advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
