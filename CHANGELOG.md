# Changelog

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
