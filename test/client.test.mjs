/**
 * Client-half smoke test: the settings card and the composer line are shipped as
 * a static `window.__ModuleLoader__.load({...})` bundle, which no bundler or
 * framework ever type-checks. This loads the real lib/client.js against a fake
 * module loader and a minimal React stub, then drives `apply()` through a fake
 * slots service — enough to catch module-scope typos, a missing export, a slot
 * key drift, or an unguarded `document`/`navigator` access.
 *
 * Run: node --test --test-isolation=none test/client.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

/* ------------------------------- stubs -------------------------------- */

const REQUIRED = new Set();

function makeReactStub() {
  REQUIRED.add("react");
  return {
    createElement: (type, props, ...children) => ({ __vnode: true, type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn
  };
}

/**
 * The bundle registers itself with `window.__ModuleLoader__.load` at module
 * scope, and ESM caches the module — so it can only be captured once. This
 * installs the fake loader, imports the bundle once and memoises the exports the
 * factory produces.
 */
let loaded = null;

function loadBundle() {
  if (loaded) return loaded;
  let captured = null;
  globalThis.window = {
    __ModuleLoader__: {
      load(config) {
        captured = config;
      }
    }
  };
  loaded = import("../lib/client.js").then(() => {
    assert.ok(captured, "the bundle must register with window.__ModuleLoader__");
    assert.equal(captured.id, "dsh-rate-limiter-renew");
    assert.equal(typeof captured.factory, "function");
    return { bundle: captured, delivered: captured.factory((specifier) => {
      if (specifier === "react") return makeReactStub();
      throw new Error(`unexpected require(${JSON.stringify(specifier)})`);
    }) };
  });
  return loaded;
}

function makeSlots() {
  const injected = [];
  const registered = [];
  return {
    injected,
    registered,
    inject(name, callback) {
      injected.push(name);
      callback();
      return () => {};
    },
    register(descriptor, render) {
      registered.push({ descriptor, render });
      return () => {};
    }
  };
}

/* -------------------------------- tests ------------------------------- */

test("client: the bundle registers itself under its own id and exports apply/inject", async () => {
  const { bundle, delivered } = await loadBundle();

  assert.equal(bundle.id, "dsh-rate-limiter-renew");
  assert.equal(typeof delivered.apply, "function");
  assert.deepEqual(delivered.inject, ["slots"]);
  assert.equal(delivered.NS, "rate-limiter-renew");
  // The row key must stay `<package>#<patch row id>`.
  assert.equal(delivered.ROW_KEY, "dsh-rate-limiter-renew#rate-limiter-renew");
  assert.ok(delivered.DICT && delivered.DICT.zh && delivered.DICT.en, "both dictionaries must ship");
});

test("client: apply() mounts the row-config page and the composer line", async () => {
  const { delivered } = await loadBundle();

  const slots = makeSlots();
  const ctx = {
    // No locale service: apply() must fall back to its own translator.
    get: () => undefined,
    effect: (fn) => fn(),
    slots
  };

  delivered.apply(ctx);

  assert.deepEqual(slots.injected, ["plugins.row.config", "conversation.composer.dock"]);

  const row = slots.registered.find((entry) => entry.descriptor.name === "plugins.row.config");
  assert.ok(row, "the plugin row config slot must be registered");
  assert.equal(row.descriptor.key, "dsh-rate-limiter-renew#rate-limiter-renew");

  const dock = slots.registered.find((entry) => entry.descriptor.name === "conversation.composer.dock");
  assert.ok(dock, "the composer dock slot must be registered");
  assert.equal(dock.descriptor.id, "rate-limiter-renew/stats-line");

  // Collapsed row view renders one line of text, not a card.
  const summary = row.render({ view: "summary" });
  assert.equal(typeof summary, "string");
  assert.ok(summary.length > 0, "the summary line must not be empty");

  // Full view renders an element tree (the stub never invokes the component, so
  // no React hooks are needed here).
  const page = row.render({ view: "page" });
  assert.equal(page.__vnode, true);
  assert.equal(page.type.name, "RateLimiterCard");

  const line = dock.render({});
  assert.equal(line.__vnode, true);
  assert.equal(line.type.name, "ComposerStatsLine");
});

test("client: apply() tolerates a host without the slots service", async () => {
  const { delivered } = await loadBundle();

  // A headless/other-platform host must not crash the bundle.
  assert.doesNotThrow(() => delivered.apply({ get: () => undefined, effect: (fn) => fn() }));
  assert.doesNotThrow(() => delivered.apply({ get: () => undefined, effect: (fn) => fn(), slots: {} }));
});

test("client: the bundle never touches document or navigator without checking", async () => {
  // Node has no DOM (and its navigator may or may not expose languages).
  assert.equal(typeof document, "undefined");

  const { delivered } = await loadBundle();
  const slots = makeSlots();
  assert.doesNotThrow(() => delivered.apply({ get: () => undefined, effect: (fn) => fn(), slots }));
  // injectCss() silently skipped; nothing may have been appended.
  assert.equal(typeof globalThis.document, "undefined");

  // With no locale service and no browser language the summary must fall back to
  // one of the two baked-in strings rather than throwing.
  const row = slots.registered.find((entry) => entry.descriptor.name === "plugins.row.config");
  const summary = row.render({ view: "summary" });
  assert.ok(
    summary === "按 (供應商, 模型) 令牌桶限速 · 等待/拒絕 · 即時統計" ||
      summary === "Per (provider, model) token bucket · wait/reject · live stats",
    `unexpected fallback summary: ${summary}`
  );
});

test("client: react is the only runtime dependency the bundle requires", async () => {
  await loadBundle();
  assert.deepEqual([...REQUIRED], ["react"]);
});
