# Changelog

## Unreleased

### Changed

* **One model control per override row, always re-selectable.** The model cell
  used to be a text input with an attached `<datalist>` *plus* a second
  `▾ 選擇模型…` picker `<select>` — two dropdowns side by side. It is now a
  single `<select>` (like the provider column) that always lists the provider's
  full set plus a leading `（全部）` option, so a chosen model stays editable at
  any time without clearing the field by hand. A stored model detection does not
  know (hand-edited substring pattern, removed provider) still appears as a
  trailing option, mirroring the provider column. The `.rlr_pair`/`.rlr_pick`
  styles and the per-row `<datalist>` are gone.
* **Model detection now reports only the routes you have added.** The limiter
  reads `llm.listProviders()` (providers with a registered adapter) and then
  `llm.listModels(provider)` for each of them, instead of also folding in
  `llm.listConfigurableProviders()` (the whole profile-declared directory,
  including dormant providers) and `llm.discoverModels()` (draft-endpoint
  candidates nothing has adopted yet). The detection panel and the provider
  `<select>` on the override rows therefore list exactly the providers and models
  in your model list. `mergeDetection()` lost its `directory` and
  `discoveredByProvider` parameters, and a provider row no longer carries
  `settingsNs` or the `directory`/`discoverModels` source tags.
* **Settings card restyle.** The card is now a hierarchical panel: a clickable
  header with status pills, sectioned `<details>` folds with icons and counts, a
  provider/model chip picker that marks the models you already have, boxed metric
  tiles for the live counters, a sticky action bar with a dirty indicator, and a
  palette built from the documented `--dsw-alias-*` tokens — replacing the
  nonexistent `--dsw-alias-label-tertiary` / `--dsw-alias-status-danger`
  variables and the hard-coded dark-mode override. Inputs, selects and buttons
  now carry explicit styling instead of depending on host defaults.
* **Basic settings are grouped by concern.** The former flat 10-field grid is
  now three labelled groups with rule-line headings — 基本設定 (scope, default
  RPM, burst), 排隊與併發 (empty-bucket mode, max wait, max concurrency) and
  退避設定 (429 back-off toggle, base/ceiling/jitter) — via new `.rlr_groups` /
  `.rlr_group` styles, so each field sits next to the ones it interacts with.

### Added

* **Three-way limit scope.** `scope: "all"` (the default) limits every route,
  `scope: "overrides"` limits only the routes that match a row in `models` and
  lets every other route pass through untouched, and `enabled: false` turns the
  limiter off entirely. The card presents the choice as one select (全部都開 /
  只為路由覆寫開 / 全部關) plus an explanatory note. `routeLimits()` in
  `lib/core.js` is the new single gate: it returns `null` for an out-of-scope
  route, and `resolveBucket`, `routeStats` and `getStats` all skip — and prune —
  such routes, so they never enter the statistics either.
* `docs/preview.mjs`, which generates `docs/preview.html` — a static mock of the
  settings card (its stylesheet is extracted from `lib/client.js`) for reviewing
  the look without installing the plugin. Not included in the published `files`.

### Fixed

* **The override table showed only column headers when no rows exist.** It now
  renders an empty state (`rowsEmpty`) with a pointer to 新增路由, matching the
  detection panel.
* The English dictionary was missing `dockQueued`, so the composer dock printed
  `undefined` for the queued count in English. A new test now asserts both
  dictionaries carry exactly the same keys, in both directions.
* **Save stayed disabled after adding an empty route row.** The dirty check
  compared `serializeDraft(draft)` with `serializeDraft(loaded)`, but
  `serializeDraft()` deliberately drops rows without a provider/model (they would
  match every route), so the two payloads were still identical. It now compares
  the drafts themselves.
* **Choosing a different model for a row meant clearing the box by hand.** A
  native `<datalist>` filters its options by the text already in the field, so as
  soon as a model was picked the list collapsed to that single entry — first
  patched with a second `▾ 選擇模型…` dropdown, now resolved by collapsing the
  cell into the single always-listed `<select>` described above. Switching a row
  to a provider that does not advertise the previous model also clears it,
  instead of leaving a model behind that the new provider does not have.
* A route row whose provider is no longer in the detected list rendered as
  `（全部）` while still saving that provider, because the `<select>` value fell
  back to `""`. The row now displays its real provider.
* Checkbox fields printed their label twice (`field()` plus the label inside
  `checkInput()`): 上游 429 冷卻, 自動偵測我的模型, 啟用 and 動態 ID.
* Clearing a number box silently saved `0` (`Number("") === 0`), which means
  "unlimited" for rpm/concurrency and "reject immediately" for `maxWaitMs`. An
  emptied field is now a validation error and blocks Save, and `intOr()`
  falls back instead of coercing. The validation note was also printing the raw
  key `requestsPerMinute`; it now says 預設 RPM.
* The stale-settings warning disappeared immediately, because the reload it
  triggers cleared the notice on its success path — the reload now runs first.
* 重設統計 reported success even when the bridge request failed.
* **The disabled Save button was unreadable.** `:disabled` only lowered the
  button's opacity, so the primary fill and its white label faded into a pale
  blue wash — which is the state Save is in whenever nothing has been edited yet.
  The disabled state now declares its own neutral background, border and label
  colour and is emitted after the primary/danger fills so it wins the cascade,
  and the base button no longer inherits its text colour from the host.
* **The *enabled* Save button could still render white-on-white.** Its fill came
  from `--dsw-alias-brand-primary`, so any host rule with a stronger selector (or
  a theme whose brand token resolves light) left the white 儲存 label sitting on
  the host's own background. The primary fill is now a literal blue pinned with
  `!important` on this plugin's own button, the disabled state is pinned to match,
  and a guard test reads the shipped stylesheet and asserts both.
* **A matching identity rule could take an unrelated request down with it.** For
  `fetch(request, init)` calls the wrapper rebuilt the `Request` to attach its
  headers, which hands the body stream over to the new object *before* anything
  can fail — a rejected rebuild (undici refuses a stream body without `duplex`)
  left the caller with a disturbed body, and every other plugin fetching a URL
  that matched a rule went through that path. The headers now travel in `init`,
  which the fetch spec merges over the `Request` itself, and the caller's object
  is passed through untouched.
* Discovery warnings rendered without React keys.
* `test/client.test.mjs` gained a render-interaction test (a stateful React stub
  that replays handlers and re-renders), covering the Save button, the provider
  switch, an off-directory provider, an emptied number box and the model
  dropdown, plus a guard test over the shipped stylesheet (every selector scoped
  to `.rlr_`, the primary fill pinned, the disabled state declared last). 58
  tests.

## 1.0.0

First release of `dsh-rate-limiter-renew`, a continuation of
`dsh-provider-rate-limit` 0.3.1 for **DeepSeek Harness 0.2.x**.

### Added

* **Automatic provider/model detection.** The limiter reads the live catalogue
  from the `llm` service — `listProviders()`, `listConfigurableProviders()`,
  `listModels(provider)` and `discoverModels(settingsNs, {provider})` as a
  fallback for profile-declared providers — so the routes it limits are the ones
  the profile actually declares, not a hand-typed table. Results are cached for
  `detectIntervalMs` and invalidated by the `llm/adapters-updated` event.
* `autoDetectModels` / `detectIntervalMs` config keys.
* `POST /api/dsh-rate-limiter-renew/models` bridge route and a model-discovery
  panel in the settings card (`Add all detected providers`, `Add missing models`).
* Per-route counters for `queued`, `activeCount`, `coolUntil`, `consecutiveFails`
  exposed through the stats service and the SSE snapshot.
* `docs/market-entry.yml`.

### Changed (framework migration)

* Settings are declared as `.volatile()` fields on the exported `Config`; the
  plugin no longer exports `installSettingsSection` and no longer calls
  `SettingsProvider#installSection`.
* The settings UI moved from the removed `settings.plugin.item` slot to the
  keyed `plugins.row.config` slot, key `dsh-rate-limiter-renew#rate-limiter-renew`,
  and is served by the plugin's own loopback bridge
  (`/api/dsh-rate-limiter-renew/{describe,replace,mutate,reset}`) instead of the
  web-settings allowlist.
* `scripts/patch-host-allowlist.mjs` was dropped — the bridge talks to the
  in-process `settings` service.
* `ctx.reflect?.provide(...)` → `ctx.provide(...)` (guarded by `typeof`).
* `dsh-client-store`'s `createSnapshotStore` is replaced by a local observable
  store (the lazy-getter initial value is no longer accepted, and `subscribe` is
  notify-only).
* Namespace, service name, bridge prefix and UI keys are all namespaced
  `rate-limiter-renew` so this plugin can coexist with the upstream one.
* `engines.dsh` is `>=0.2.0-0` (node-semver only accepts a prerelease when the
  comparator carries one, so a `0.1.x`-anchored range can never match `0.2.0-rc.*`).

### Fixed (defects carried over from the upstream implementation)

* `TokenBucket.coolUntil` was initialised to `0`; on a monotonic clock that is a
  real instant, so the first few slots were clamped to time zero and the
  configured burst collapsed to 1. It is now `Number.NEGATIVE_INFINITY`.
* The identity patch built its wrapper but **never assigned
  `globalThis.fetch = wrapper`**, so gateway identity rules were inert. It is
  assigned now and released ref-counted on dispose.
* `releaseConcurrencySlot` hands a slot straight to the oldest waiter, so
  incrementing `activeCount` inside `grant()` leaked one slot per hand-off; the
  increment was removed.
* Per-route overrides were resolved in declaration order, so a provider-wide row
  always beat a more specific model row; resolution is now a single scored pass
  (exact > substring, model > provider, specific > global).

### Tests

51 tests (`24 core + 22 host + 5 client`), run offline against stubbed DSH
internals: `npm test`.
