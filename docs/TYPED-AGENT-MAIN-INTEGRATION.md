# Auxiliary integration of #976 and #1331

This is a reviewable integration experiment, not a duplicate PR, upstream
approval, or release certification. Neither contributor's original branch was
modified. The original commits and authorship remain in the merge ancestry.

## Pinned inputs and branches

- Upstream main: `0d1a68160e532ba65dc34b48ea205de6de4028fc` (#1494),
  rechecked against GitHub before publication.
- darrendignam #976: `afe30629b1fbea988193a201a2427d0c46c3e2bf`.
- radianx #1331: `0bd66fe981dc4a208fbbdf37df680c90b118261e`.
- Core-only auxiliary branch:
  `radianx/gods-eye-view:integration/typed-agent-core-main-20261101`.
- Separate ChatGPT compatibility branch:
  `radianx/gods-eye-view:integration/command-on-typed-base-20261101`.
- Validated core code tree: `b40bd0375f2ab300e9f56ff2cb2e0eb68ec5f5a8`.
- Validated combined code tree: `6a4594d4e8b604c40201867d13b3c5fbeb75838f`.
  The published tips add this report to those code trees. GitHub tree SHAs were
  compared with the local trees before publication.

The core branch contains no ChatGPT/OAuth implementation from #1331. The
compatibility branch retains #1331 and the core branch as merge parents.

## Reproduced conflicts in #976

Merging #976 onto the pinned main produces exactly three unmerged paths:

| Path                        | Resolution                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/format-scope.json` | Keep current main's paths and add the agent's paths; exclude paths removed by upstream, including Snow and the former UI composition modules. |
| `src/i18n/locales/es.json`  | Keep upstream translations and add the 19 agent messages. Do not restore obsolete messages deleted by main.                                   |
| `src/i18n/locales/ru.json`  | Same three-way reconciliation, preserving existing translations and placeholders.                                                             |

Additional integration repairs, beyond Git's conflict markers:

- Complete the 19 COMMAND messages in de/fr/it/ja/pt/uk/zh-CN/zh-Hant.
  The Chinese COMMAND entries reuse #1331's existing translations. All ten
  shipped catalogs have 2,756 extracted messages and pass the i18n check.
  Newly supplied translations still benefit from native-speaker review.
- Correct `qa-agent-console.mjs` from `.panel-resize-grip` to
  `.agent-resize-grip`. The latter is #976's actual self-contained handle;
  the removed floating-rail resize implementation is not restored.
- Preserve current main's instructions while extracting the directive array.
  Both default and custom-annotation `realtimeInstructions()` outputs were
  compared byte-for-byte against the pinned main and are identical.

`agentLoop.js`, `conversation.js`, `consoleBox.js`, `boxResize.js` and the
console's production UI remain exactly as in #976. In particular:

- Cancellation is checked before dispatching the next action after an awaited
  action. An already-running action retains its real result.
- Unstarted tool calls receive cancellation results, keeping the assistant's
  `tool_calls` and tool messages paired for the next command.
- Dialog geometry, all-edge resize, persistence and attribution clearance stay
  owned by the console, without reviving rail-panel machinery.
- Status keys remain untranslated internally; rendered status text is localized.

## Compatibility with #1331

A separate worktree starts at the pinned #1331 head and merges the core-only
auxiliary base. Git reports eight conflicted paths:

- `scripts/format-scope.json`
- `scripts/package-boundaries.json`
- `server/providers/openai/instructions.js`
- `src/i18n/index.js`
- `src/i18n/locales/es.json`
- `src/i18n/locales/ru.json`
- `src/i18n/locales/zh-Hant.json`
- `src/voice/actionSchemas.test.mjs`

Resolution combines the current locale registry with COMMAND's conditional
Arabic supplement, preserves #1331's resulting-HUD-state instruction, merges
package ownership and formatting additions, and retains upstream's retirement
of Snow and Operator. The schema digest is updated for the specifically
reviewed combination: current upstream tool schema plus #1331's Street Level
panel target; the legacy comparison explicitly removes that additive target.
No production tool or argument is changed to make a digest pass.

The six newly shipped non-Chinese locales receive #1331's 13 ChatGPT control
messages, with all ten catalogs complete at 2,769 extracted messages.

The following production code is byte-identical to the original #1331 head:
`server/providers/agent/chatgpt/`, `src/agent/chatgptControls.js`,
`src/agent/agentLoop.js`, `src/agent/conversation.js`, `src/agent/consoleBox.js`
and `src/agent/boxResize.js`. Thus the reconciliation does not rewrite OAuth,
Responses SSE validation, account binding, STOP, transcript serialization or
console geometry. Executed fixture tests below provide behavioral evidence;
they do not certify live account eligibility or inference.

## Executed validation

Linux, Node 24.22.1, Chrome Headless Shell 156.0.8078.47. The core tree uses the
already installed upstream dependency set; the combined tree has a fresh
`npm ci --ignore-scripts` installation from its reconciled lockfile.

| Gate                                                    | Core-only                                       | Core + #1331                           |
| ------------------------------------------------------- | ----------------------------------------------- | -------------------------------------- |
| Focused agent/ChatGPT/security/schema tests             | 259 passed, 0 failed                            | 442 passed, 32 skipped, 0 failed       |
| Ordinary unit suite (core: two workers; combined: four) | 9,381 passed, 2 skipped, 0 failed (clean retry) | 9,555 passed, 34 skipped, 0 failed     |
| Serialized allocation probes                            | 15 passed, 0 failed                             | 15 passed, 0 failed                    |
| Production build                                        | Passed                                          | Passed                                 |
| Formatting                                              | Passed, 1,553 scoped files                      | Passed, 1,586 scoped files             |
| Import/package boundaries                               | Passed                                          | Passed                                 |
| Layer-token check against main                          | 32 published, 0 new                             | 32 published, 0 new                    |
| Changelog fragments                                     | Passed                                          | Passed                                 |
| Setup doctor                                            | Ready                                           | Ready                                  |
| i18n                                                    | All ten catalogs complete                       | All ten catalogs complete              |
| Browser offline console gate                            | Passed on actual dev application                | Passed on actual production preview    |
| Browser ChatGPT controls                                | Not part of this branch                         | 24 locale/viewport combinations passed |

The first core ordinary run failed only
`src/layers/traffic/navigation.test.mjs`:
“a settled footprint loads new tiles even when the camera centre stays put”
(`0 !== 1`). That file passes 15/15 in isolation on both this tree and unchanged
main. Its timing-sensitive failure was not repaired or its deadline relaxed.
The original full run is not represented as green. A second complete ordinary
run with two workers passed 9,381 tests, skipped two, and failed none in
225.9 seconds. The combined four-worker run passed in 146.2 seconds.

The offline console gate exercises actual mount, lazy provider loading,
provider endpoints, chip/dialog state, attribution clearance, drag, remembered
geometry, corner resize, Escape and absence of console/render errors. Offline
mode intentionally skips model inference. Ollama's model-list request reports
502 because no daemon is installed; this is observed unavailability, not a
successful Ollama inference check.

The ChatGPT browser fixture uses the real template, controller, styles and
translations. It covers tool/result round trips, account isolation, STOP,
logout, sign-in copy and layout at 1280x800 and 800x800 for en/de/es/fr/it/ja/pt/
ru/uk/zh-CN/zh-Hant/zh-TW (24 combinations). It uses synthetic endpoints and no
real credentials.

## Reproduction

Run each branch separately with Node 24 and its lockfile:

```sh
npm ci
node --test --test-concurrency=4 src/agent/*.test.mjs
npm run build
npm run format:check
npm run check:boundaries
node scripts/i18n.mjs
node scripts/check-layer-state-tokens.mjs --base-ref origin/main
node scripts/assemble-changelog.mjs --check
node scripts/setup-doctor.mjs --json
```

The ordinary suite used `discoverUnitTestFiles()` and `buildUnitTestPlan()`
from `scripts/run-unit-tests.mjs`, passing `plan.parallel` to
`node --test --test-concurrency=4`. Each `plan.serializedAllocations` file was
then run separately with `node --expose-gc --test --test-concurrency=1`.
The core retry uses two ordinary workers.

With a local dev or production-preview server running:

```sh
node scripts/qa-agent-console.mjs --url http://127.0.0.1:4189 --offline
```

On the compatibility branch:

```sh
node scripts/qa-agent-chatgpt.mjs
QA_AGENT_LOCALES=de,fr,it,ja,pt,uk node scripts/qa-agent-chatgpt.mjs
```

Set `PUPPETEER_EXECUTABLE_PATH` if Chrome Headless Shell is installed outside
Puppeteer's default Chrome path.

## Limits and adoption

No live OAuth/account grant, real model inference, allowance/refresh/revocation
or paid API calls were performed. Native Windows DACL tests and Docker Compose
require other environments. The combined suite also intentionally skips
independent #1488 provenance and unavailable RTL integrations. Neither #1488
nor Arabic registration is pulled into these branches. There is no claim about
hosted GitHub CI, microphone/audio, native Windows, physical devices, broad
tracking/GPU release QA, or native-speaker linguistic approval.

For darrendignam, the core auxiliary tip is a descendant of the exact #976 head.
After reviewing the compare, the author can fetch it into their own checkout
and fast-forward their topic, without squashing away attribution:

```sh
git fetch https://github.com/radianx/gods-eye-view.git integration/typed-agent-core-main-20261101
# From the author's own feat/typed-agent-core branch, after review:
git merge --ff-only FETCH_HEAD
```

Only the original author should choose whether to update #976. The separate
ChatGPT branch demonstrates the proposed merge order, #976 then #1331; the
original #1331 remains a draft with its live-account and platform release
gates. Recheck against main and rerun the relevant gates if any input moves.

## Production-preview check

The combined production build also passed the actual offline console gate with
`--provider chatgpt --offline` against Vite preview: mount, lazy controls,
drag/resize/persistence, Escape and no console/render errors. No live ChatGPT
account or inference was used.
