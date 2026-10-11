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
import { readFileSync } from "node:fs";
import test from "node:test";

/* ------------------------------- stubs -------------------------------- */

const REQUIRED = new Set();

/**
 * A minimal but *stateful* React runtime. The real GUI re-renders on every
 * setState, so a bug that only appears after an interaction (a stale datalist, a
 * Save button that never enables) is invisible to a stub whose setter is a
 * no-op. `useState` therefore owns a real cell array and flags a re-render.
 */
let cursor = 0;
let dirty = false;
const cells = [];

const reactRuntime = {
  createElement: (type, props, ...children) => ({ __vnode: true, type, props: props ?? {}, children }),
  useState(initial) {
    const index = cursor++;
    if (!(index in cells)) cells[index] = typeof initial === "function" ? initial() : initial;
    const set = (next) => {
      const value = typeof next === "function" ? next(cells[index]) : next;
      if (value !== cells[index]) {
        cells[index] = value;
        dirty = true;
      }
    };
    return [cells[index], set];
  },
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn()
};

function makeReactStub() {
  REQUIRED.add("react");
  return reactRuntime;
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

test("client: the limit-scope control is translated in both dictionaries", async () => {
  const { delivered } = await loadBundle();
  const { zh, en } = delivered.DICT;

  const keys = ["scope", "scopeHint", "scopeAll", "scopeOverrides", "scopeOff", "scopeOffNote", "scopeOverridesNote"];
  for (const key of keys) {
    assert.equal(typeof zh[key], "string", `zh.${key} is missing`);
    assert.equal(typeof en[key], "string", `en.${key} is missing`);
  }

  // The three presented choices must be three distinct labels, not two labels
  // and a repeat.
  assert.equal(new Set([zh.scopeAll, zh.scopeOverrides, zh.scopeOff]).size, 3);
  assert.equal(new Set([en.scopeAll, en.scopeOverrides, en.scopeOff]).size, 3);

  // Both dictionaries must stay in lockstep, in both directions.
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
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

/* --------------------- interaction (re-render) tests -------------------- */

function textOf(node) {
  return node.children.flat(Infinity).filter((child) => typeof child === "string" || typeof child === "number").join("");
}

function* walkTree(node) {
  if (node === null || node === undefined || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) yield* walkTree(child);
    return;
  }
  if (node.__vnode) {
    yield node;
    for (const child of node.children) yield* walkTree(child);
  }
}

/**
 * RateLimiterCard's hook cells in call order. The stub has no reconciler, so the
 * card is invoked directly with these seeded, and the resulting handler props are
 * replayed to emulate one interaction at a time.
 * 0 stats · 1 draft · 2 loaded · 3 revision · 4 writable · 5 status ·
 * 6 detection · 7 notice · 8 saving · 9 open · 10 detecting
 */
function mountCard(Component, t, draft, loaded, detection) {
  cursor = 0;
  dirty = false;
  cells.length = 0;
  cells.push(null, draft, loaded, 7, true, "ready", detection, null, false, true, false);
  return Component({ t, page: true });
}

function makeSurface(Component, t, detection) {
  let tree = null;
  const nodes = () => [...walkTree(tree)];
  return {
    nodes,
    /** Replay a handler, then re-render until setState settles (real GUI loop). */
    act(handler, event) {
      handler(event);
      let guard = 0;
      while (dirty && guard++ < 30) {
        cursor = 0;
        dirty = false;
        tree = Component({ t, page: true });
      }
    },
    mount(draft, loaded = draft) {
      tree = mountCard(Component, t, draft, loaded, detection);
      return tree;
    },
    save: () => nodes().find((n) => n.type === "button" && n.props["data-primary"]),
    button: (label) => nodes().find((n) => n.type === "button" && textOf(n) === label)
  };
}

test("client: interacting with the card keeps Save and the model list honest", async () => {
  const { delivered } = await loadBundle();
  const slots = makeSlots();
  delivered.apply({ get: () => undefined, effect: (fn) => fn(), slots });
  const row = slots.registered.find((entry) => entry.descriptor.name === "plugins.row.config");
  const Component = row.render({ view: "page" }).type;
  const t = (key) => delivered.DICT.zh[key] ?? key;

  const detection = {
    providers: [
      { id: "nvidia", name: "NVIDIA", models: [{ id: "deepseek-v4.1-flash" }, { id: "glm-4.6" }] },
      { id: "openrouter", name: "OpenRouter", models: [{ id: "llama-3.3-70b" }] }
    ],
    errors: [],
    detectedAt: 0
  };
  const base = {
    scope: "all",
    requestsPerMinute: 20,
    burst: 4,
    mode: "wait",
    maxWaitMs: 30000,
    upstream429Backoff: true,
    backoffMs: 30000,
    maxBackoffMs: 60000,
    backoffJitter: 0,
    maxConcurrentRequests: 0,
    autoDetectModels: true,
    detectIntervalMs: 60000,
    models: [{ provider: "nvidia", model: "deepseek-v4.1-flash", requestsPerMinute: 20, burst: 4 }],
    identityRules: []
  };
  const surface = makeSurface(Component, t, detection);
  const providerSelect = () =>
    surface.nodes().find((n) => n.type === "select" && n.children.some((o) => o.props && o.props.value === "openrouter"));

  // An unchanged draft has nothing to save.
  surface.mount(base);
  assert.equal(surface.save().props.disabled, true);
  assert.equal(surface.save().props["data-primary"], "true");

  // Adding an empty route row is still a change worth saving. This used to leave
  // Save disabled, because serializeDraft() drops rows without a provider.
  surface.mount(base);
  surface.act(surface.button(delivered.DICT.zh.addRow).props.onClick);
  assert.equal(surface.nodes().filter((n) => n.type === "input" && n.props.list).length, 2);
  assert.equal(surface.save().props.disabled, false);

  // Switching the row to another provider must drop the model that provider does
  // not advertise: a native <datalist> filters by the text in the box, so the
  // left-over model used to hide every suggestion and the model became unpickable.
  surface.mount(base);
  surface.act(providerSelect().props.onChange, { target: { value: "openrouter" } });
  const modelInput = surface.nodes().find((n) => n.type === "input" && n.props.list);
  assert.equal(providerSelect().props.value, "openrouter");
  assert.equal(modelInput.props.value, "");
  const list = surface.nodes().find((n) => n.type === "datalist" && n.props.id === modelInput.props.list);
  assert.deepEqual(list.children.map((o) => o.props.value), ["llama-3.3-70b"]);

  // The dropdown must keep offering the provider's whole list even when the box
  // already holds a model, otherwise picking a second one means clearing the
  // field by hand first (the datalist collapses to the current value).
  surface.mount(base);
  const modelPicker = () =>
    surface.nodes().find(
      (n) => n.type === "select" && typeof n.props.className === "string" && n.props.className.includes("rlr_pick")
    );
  const modelValue = () => surface.nodes().find((n) => n.type === "input" && n.props.list).props.value;
  assert.deepEqual(modelPicker().children.map((o) => o.props.value), ["", "deepseek-v4.1-flash", "glm-4.6"]);
  surface.act(modelPicker().props.onChange, { target: { value: "glm-4.6" } });
  assert.equal(modelValue(), "glm-4.6");
  assert.deepEqual(modelPicker().children.map((o) => o.props.value), ["", "deepseek-v4.1-flash", "glm-4.6"]);
  surface.act(modelPicker().props.onChange, { target: { value: "deepseek-v4.1-flash" } });
  assert.equal(modelValue(), "deepseek-v4.1-flash");

  // A provider detection does not know must still be shown, not silently
  // rendered as "（全部）" while the row actually saves that provider.
  surface.mount({ ...base, models: [{ provider: "zai", model: "glm-4.6", requestsPerMinute: 5, burst: 2 }] });
  assert.equal(providerSelect().props.value, "zai");

  // An emptied number box must block Save rather than silently serialize as 0.
  surface.mount(base);
  surface.act(
    surface.nodes().find((n) => n.type === "input" && n.props.type === "number" && n.props.value === 20).props.onChange,
    { target: { value: "" } }
  );
  assert.equal(surface.save().props.disabled, true);
  const notes = surface.nodes().filter((n) => n.props && n.props.className === "rlr_note").map((n) => textOf(n));
  assert.ok(
    notes.some((line) => line.includes(delivered.DICT.zh.defaultRpm)),
    `expected the ${delivered.DICT.zh.defaultRpm} validation note, got ${JSON.stringify(notes)}`
  );
  assert.ok(!notes.some((line) => line.includes("requestsPerMinute")), "the note must not leak a raw dictionary key");
});

/**
 * The stylesheet is injected into `document.head`, so a single unscoped selector
 * would restyle the whole GUI, and the save button's label has to survive the
 * host's own button rules. Both are invisible to a React-stub test, so they are
 * asserted against the shipped CSS text.
 */
test("client: the injected stylesheet stays scoped and keeps the save label readable", () => {
  const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  const start = source.indexOf("const css = [");
  assert.notEqual(start, -1, "the `const css = [` block moved");
  const open = start + "const css = ".length;
  const close = source.indexOf('].join("");', open);
  assert.notEqual(close, -1, 'the `].join("");` terminator moved');
  const css = Function(`"use strict";return (${source.slice(open, close + 1)});`)().join("");

  // 1. Nothing may leak onto other plugins or the app shell.
  for (const chunk of css.split("{").slice(0, -1)) {
    const selector = chunk.slice(chunk.lastIndexOf("}") + 1).trim();
    if (selector.startsWith("@")) continue;
    for (const part of selector.split(",")) {
      const item = part.trim();
      if (item === "" || /^[\d,%\s]+$/.test(item) || /^(from|to)$/.test(item)) continue; // @keyframes steps
      assert.ok(item.includes(".rlr_"), `unscoped selector escapes the card: ${JSON.stringify(item)}`);
    }
  }

  // 2. The primary fill is a literal, pinned blue: with a token the host theme
  //    could resolve to a light colour the white "儲存" label disappeared.
  const primary = css.match(/\.rlr_btn\[data-primary=true\]\{([^}]*)\}/);
  assert.ok(primary, "the primary button rule is missing");
  assert.match(primary[1], /background:#[0-9a-f]{6}!important/, "the primary fill must not depend on a theme token");
  assert.match(primary[1], /color:#fff!important/, "the primary label must be pinned white");

  // 3. The disabled state has to beat the pinned primary fill, and be declared
  //    after it, or a dead button keeps looking like an enabled one.
  const disabled = css.match(/\.rlr_btn:disabled[^{]*\{([^}]*)\}/);
  assert.ok(disabled, "the disabled button rule is missing");
  assert.match(disabled[1], /background:[^;]*!important/, "disabled must override the pinned primary fill");
  assert.ok(css.indexOf("[data-primary=true]{") < css.indexOf(".rlr_btn:disabled"), "disabled must be declared last");
});
