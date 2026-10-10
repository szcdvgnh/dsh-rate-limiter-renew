# dsh-rate-limiter-renew

Per-**provider + model** rate limiting for **DeepSeek Harness 0.2.x**.

A modernised continuation of [`dsh-provider-rate-limit`](https://github.com/jyao-SUSE-power-group/dsh-provider-rate-limit)
(0.3.1). Every feature of the original is preserved; the parts of it that the
0.2.x framework removed or replaced have been rewritten, and one large piece of
new behaviour was added: **the limiter now discovers the models you actually
have, instead of relying on a hard-coded route table.**

```
llm call ──▶ llm/stream interceptor
              ├─ master switch off? ──────────────▶ pass through
              ├─ resolve (provider, model) ─▶ token bucket
              │    ├─ wait mode: sleep, then continue
              │    └─ reject mode (or wait > maxWaitMs): finish{ RATE_LIMIT }
              ├─ concurrency gate (optional FIFO)
              └─ adapter stream
                   └─ finish.error.status === 429 ─▶ cool the route down
                                                     (and still forward it)
```

---

## 1. Why a renewal

| Upstream design | Status in 0.2.x | What this plugin does |
| --- | --- | --- |
| `installSettingsSection()` exported at module level | **removed** — importing it crashed at load time | gone; config lives in the profile-owned `Config` |
| `SettingsProvider#installSection` / `register(ns, schema)` | **removed** | host-owned `settings` service + a plugin-owned UI card |
| Settings page slot `settings.plugin.item` | **removed** (rc.1) | `plugins.row.config` keyed slot (`dsh-rate-limiter-renew#rate-limiter-renew`) |
| `ctx.reflect?.provide(name, service)` | superseded | `ctx.provide(name, service)` |
| `dsh-client-store` `createSnapshotStore(lazyGetter)` | lazy getter no longer accepted; `subscribe` is notify-only | a 20-line local observable store |
| `scripts/patch-host-allowlist.mjs` (patched the host's web-settings allowlist) | unnecessary | the bridge calls the in-process `settings` service directly |
| Route table hard-coded to whatever provider the user typed | cannot see a user's custom providers | reads the live catalogue from the `llm` service |

Nothing was dropped from the feature list: token buckets, wait/reject modes,
strict FIFO reservations, upstream-429 back-off, per-route overrides, gateway
identity rewriting, the enable/disable switch, the stats UI, the SSE feed, the
HTTP stats endpoint and the cross-plugin stats service are all still here.

---

## 2. Requirements

* **DeepSeek Harness `0.2.0-rc.0` or newer** (`0.2.0-rc.2` and `0.2.0` verified;
  `dsh.engines.dsh` is `>=0.2.0-0` — the `-0` suffix is what makes the range
  match prereleases, because node-semver only accepts a prerelease when the
  comparator carries one of its own).
* Node.js 22.8+ (the host runtime ships a newer one; only needed to run the tests).
* A web platform profile (`dsh.client.platform = "web"`) for the settings card
  and the composer line. The host half works headless.

---

## 3. Install

### 3.1 As a profile dependency (recommended)

```powershell
# 1) put the package inside the profile
cd "$env:USERPROFILE\.dsh\profiles\desktop"
npm install "file:C:\path\to\dsh-rate-limiter-renew"
#    …or from a tarball / git URL / registry, depending on how you ship it
```

```yaml
# 2) $env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml
- insert:
    - id: rate-limiter-renew
      name: dsh-rate-limiter-renew
      inject: [llm]
      config:
        enabled: true
```

```jsonc
// 3) only if you want it in the *bundle* list as well
//    $env:USERPROFILE\.dsh\profiles\desktop\package.json
"dsh": { "profile": { "bundles": [ … , "dsh-rate-limiter-renew" ] } }
```

Restart DSH afterwards (the profile composition is read at startup).

> The `id` in `cordis.patch.yml` **is** the settings namespace **and** the second
> half of the UI row key (`dsh-rate-limiter-renew#rate-limiter-renew`). Keep it
> exactly `rate-limiter-renew` unless you also change `NS` in `lib/index.js` and
> `ROW_KEY` in `lib/client.js`.

### 3.2 Copy-in install

Drop the directory into `<profile>\node_modules\dsh-rate-limiter-renew\` and add
the same patch entry. The only runtime dependency is
`@deepseek-ai/schemastery` (already present in every 0.2.x profile); every other
`@deepseek-ai/*` import is resolved by the DSH loader itself, which is why this
package deliberately declares **no** `peerDependencies` — a peer range is one
more thing that can fail to resolve, and it bought nothing.

There is **no build step**: `lib/index.js` is plain ESM, `lib/client.js` is a
static `window.__ModuleLoader__.load({...})` bundle. Neither needs a bundler.

### 3.3 Install from GitHub

Repository: <https://github.com/szcdvgnh/dsh-rate-limiter-renew>

```powershell
# A CLI-managed profile (e.g. web). The desktop profile is owned by the Electron app.
dsh plugin --profile web add "github:szcdvgnh/dsh-rate-limiter-renew"

# Reproducible: pin a commit (pnpm fetches a codeload tarball for github:, not a git clone)
dsh plugin --profile web add "github:szcdvgnh/dsh-rate-limiter-renew#<commit-sha>"
```

Installing through the **in-app market** has two preconditions: the market only
installs sources listed in
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin),
and its source order is “repo-verified npm package → GitHub Release prebuilt
tarball → whole-repo source”. To make it a one-click install, send a PR to that
curated list (usually picked up within a day) and attach the `pnpm pack` output
`dsh-rate-limiter-renew-1.0.0.tgz` to the `v1.0.0` release — the prebuilt route
installs in seconds and runs no build scripts (this package has none anyway).

> Installing from `github:` only *places* the package; *activation* happens when
> its `dsh.bundle.patch` is written into `dsh.profile.bundles`, or when you add
> the patch entry from 3.1 yourself.

---

## 4. Configuration

All fields are editable live from the plugin page (侧栏 → 插件 → 已安装 →
dsh-rate-limiter-renew → 行配置). Every field is declared `.volatile()`, so the
host hands the plugin a live reference and edits apply without a restart.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch. Checked **per request**, so toggling it takes effect immediately (no listener re-registration). |
| `requestsPerMinute` | number | `20` | Refill rate for the default route. **`0` means unlimited** — an explicit sentinel, not "unset". |
| `burst` | number | `4` | Bucket capacity. `1` disables bursting. |
| `mode` | `"wait"` \| `"reject"` | `"wait"` | What to do when the reserve would block. Unknown strings fall back to `wait`. |
| `maxWaitMs` | number | `30000` | In `wait` mode, a reserve longer than this is rejected instead. `0` = reject whenever a wait would be needed. |
| `upstream429Backoff` | boolean | `true` | Cool a route down when the adapter returns HTTP 429. |
| `backoffMs` | number | `30000` | First cool-down duration. |
| `maxBackoffMs` | number | `60000` | Ceiling for the doubling cool-down. |
| `backoffJitter` | number | `0` | `0..1` symmetric jitter applied to the cool-down. |
| `maxConcurrentRequests` | number | `0` | In-flight cap per route. `0` = unlimited. Strict FIFO when > 0. |
| `autoDetectModels` | boolean | `true` | Discover providers/models from the `llm` service. |
| `detectIntervalMs` | number | `60000` | Discovery TTL/refresh interval (floor 5000 when > 0; `0` disables the timer). |
| `models` | array | `[]` | Per-route overrides — see below. |
| `identityRules` | array | `[]` | Gateway identity rewriting — see below. |

### 4.1 Per-route overrides (`models`)

```yaml
models:
  - provider: nvidia                 # exact or substring match
    model: deepseek-v4.1-flash       # empty = every model of that provider
    requestsPerMinute: 10
    burst: 2
  - provider: openrouter
    requestsPerMinute: 0             # unlimited for this provider only
```

Matching is a single scored pass, most specific wins:

* exact `provider` **and** exact `model` — returned immediately;
* otherwise `score = (provider exact ? 4 : provider substring ? 2 : 0)
  + (model exact ? 8 : model substring ? 4 : 0)`, highest score wins;
* an empty `provider`+`model` row is the global row and only applies when no
  narrower row matches.

So an exact provider beats a substring, a model pattern beats a provider-wide
row, and both beat the global default. A row whose `provider` matches but whose
`model` pattern does not is skipped entirely (it does not fall back to a lesser
match).

### 4.2 Gateway identity rewriting (`identityRules`)

Some gateways (OpenCode Zen above all) fingerprint the client. A rule rewrites
the outbound request before it leaves the process:

```yaml
identityRules:
  - urlPattern: opencode.ai/zen      # substring match against the request URL
    enabled: true
    userAgent: "opencode/1.18.25 ai-sdk/provider-utils/4.0.38 runtime/bun/1.3.14"
    dynamicIds: true                 # inject x-opencode-client/project/session/request
    headers:
      - name: x-custom
        value: "1"
```

* `dynamicIds: true` injects `x-opencode-client: cli`, `x-opencode-project: global`,
  `x-opencode-session: ses_<ULID>` (stable for the lifetime of the plugin
  instance) and `x-opencode-request: msg_<ULID>` (fresh per request).
* Static `headers` are applied **last**, so they can override anything above.
* A rule with `enabled: false`, or a blank `urlPattern`, is skipped; with no
  active rules the wrapper is a pure pass-through.
* `globalThis.fetch` is patched ref-counted on a `Symbol.for(...)` key and is
  restored to the exact native function on dispose (only if it is still ours).

The card has a one-click **Apply OpenCode Zen preset** button.

---

## 5. Automatic model detection

This is the headline addition. The original plugin could not see anything the
user had not typed by hand, because it walked a static route table. This plugin
asks the host for the truth:

1. `llm.listProviders()` — every adapter in the registry;
2. `llm.listConfigurableProviders()` — the profile-declared provider directory,
   which carries the `settingsNs`/`settingsPath` of each provider config (this is
   where e.g. a custom `llm-pi-ai` entry and its 10 providers show up);
3. `llm.listModels(provider)` for anything the registry knows;
4. `llm.discoverModels(settingsNs, { provider })` for directory providers that
   came back empty — the same call the "Fetch models" button in the host UI makes.

The result is merged into `{ id, name, sources[], settingsNs, models[] }` per
provider, cached for `detectIntervalMs` and invalidated by the
`llm/adapters-updated` event (adapter registration or directory changes). The
settings card renders it as a table with **Add all detected providers** and
**Add missing models** buttons, and the provider column of the override rows is a
`<select>` of the detected providers (plus `所有`/`all` and whatever value a row
already holds).

Detection never throws: a provider that fails to answer is reported in the
snapshot with its error and the rest of the catalogue is still usable.

---

## 6. Statistics

| Surface | How |
| --- | --- |
| Settings card | live counters + per-route table, pushed over SSE |
| Composer line | `⏱ 20/min ×4 · 12 total · 3 waited · 0 rejected · 1 queued · 2 routes` right in the composer dock; hover for per-route detail |
| HTTP | `POST /api/dsh-rate-limiter-renew/stats` |
| SSE | `GET /api/dsh-rate-limiter-renew/events` (`event: snapshot`, 15 s heartbeat, snapshot immediately on connect) |
| Cross-plugin | service `rate-limiter-renew/stats` → `getStats(provider, model)`, `getAllStats()`, `getAggregateStats()`, `resetStats()`, `detectModels({force})`, `getDetectedModels()` |

```js
const stats = ctx.get("rate-limiter-renew/stats");
stats.getAggregateStats();
// { total, waited, rejected, queued, reserved, totalWaitMs, activeCount, routes }
```

Per-route counters: `reserved`, `waited`, `totalWaitMs`, `rejected`, `queued`,
`activeCount`, `unlimited`, `coolUntil`, `consecutiveFails`.

### Bridge endpoints

All bridge routes are `POST`, JSON, **loopback-only** (remote address, `Host`
header and `Origin`/`Sec-Fetch-Site` are all checked) and body-capped at 64 KiB:

`/describe` · `/replace` · `/mutate` · `/reset` · `/models` · `/stats` ·
`/stats-reset` · `GET /events`

They call the in-process `settings` service, so there is no allowlist to patch
and no `settings-not-exposed` failure mode — the namespace is exposed as soon as
the patch row exists.

---

## 7. Alerts & interop

* **Rejections are first-class LLM failures.** A rejected call finishes with
  `{ type: "finish", reason: { kind: "error", failure: { code: "RATE_LIMIT",
  status: 429, providerRetryAfterMs } } }`, so a retry plugin downstream sees a
  normal retryable 429 rather than a mystery.
* **Upstream 429s still reach `dsh-llm-retry`.** The plugin cools the local route
  down and *forwards* the original finish untouched.
* **Aborts are honoured.** A queued/sleeping request aborted by the caller
  finishes with `reason.kind === "aborted"` and leaves the FIFO queue.

---

## 8. Development & tests

```bash
npm test          # 51 tests: 24 core + 22 host + 5 client
npm run check     # node --check on all three entry points
```

The suite runs offline. `test/harness/register.mjs` installs an ESM resolve hook
that maps `@deepseek-ai/dsh-settings` and `@deepseek-ai/schemastery` (which live
*inside* DSH, not on npm) onto ~80-line stubs, so `lib/index.js` is loaded for
real and driven by a fake Cordis `ctx` — including a fake `webServer` with a
duplicate-route check and a fake `settings` service that can raise
`SettingsConflictError`.

`test/client.test.mjs` loads the real `lib/client.js` through a fake
`window.__ModuleLoader__` and a minimal React stub, then asserts that `apply()`
mounts both slots with the expected keys — the static bundle is otherwise never
checked by any toolchain.

```
test/
  core.test.mjs           token bucket, ULID, limits, back-off, merges, diffs
  host.test.mjs           interception, modes, concurrency, identity patch, bridge
  client.test.mjs         bundle loader, exports, slot registration
  harness/register.mjs    --import entry point
  harness/hooks.mjs       ESM resolve hook (stub mapping)
  harness/stub-*.mjs      schemastery + SettingsConflictError stubs
```

> On Windows under a sandboxed shell, `node --test test/` fails with
> `Error: spawn EPERM` (the test runner spawns one process per file and piped
> stdio is blocked) and `--test-isolation=none test/` hits
> `ERR_UNSUPPORTED_DIR_IMPORT`. Listing the files explicitly — which is what the
> `test` script does — works everywhere.

---

## 9. Known limitations

1. **Only HTTP 429 is recognised upstream.** Other failure shapes (a JSON body
   with a quota message, 402, 503) are not treated as rate limits.
2. **Detection is best-effort.** It reports what the `llm` service will disclose.
   A provider whose adapter refuses `listModels` and has no directory entry
   cannot be discovered; add it by hand instead.
3. **Bucket state is in-memory and per process.** Reloading the profile resets
   counters and cool-downs (deliberate — persisted tokens would be worse).
4. **The identity patch is process-global.** Any `fetch` in the host process is
   subject to it, not just LLM traffic; rules are URL-scoped and the patch is
   restored on dispose, but another plugin patching `fetch` at the same time
   could interleave.
5. **`x-opencode-session` is stable per plugin instance**, not per conversation.
   The upstream code minted a fresh session id per request; that is what the
   gateway fingerprints against, so it was changed deliberately.
6. **The client is a static `web` bundle.** There is no React/JSX toolchain, so
   the card is written with `createElement`. Other platforms (CLI/TUI) still get
   the host half, but no card or composer line.
7. **No `peerDependencies`.** Deliberate (see §3.2), but it does mean npm will not
   warn you if the plugin is installed next to an incompatible DSH.

---

## 10. Licence

MIT — see [LICENSE](./LICENSE). Continuation of
`dsh-provider-rate-limit` (MIT), whose structure and feature set this plugin
keeps.
