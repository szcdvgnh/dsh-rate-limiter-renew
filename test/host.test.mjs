/**
 * Host-half tests: load the real lib/index.js against a fake Cordis ctx and
 * exercise the behaviour that matters — per-route pacing, wait/reject modes, the
 * concurrency gate, upstream-429 cool-down, the gateway identity patch, model
 * auto-detection and the loopback HTTP bridge.
 *
 * Run (Node >= 22.8, from the package root):
 *   node --test --test-isolation=none --import ./test/harness/register.mjs \
 *     test/core.test.mjs test/host.test.mjs
 * The `--import` hook maps @deepseek-ai/dsh-settings and @deepseek-ai/schemastery
 * (which live inside DSH, not on npm) onto test/harness stubs.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SettingsConflictError } from "@deepseek-ai/dsh-settings";
import { apply, BRIDGE_PREFIX, Config, inject, name, NS, SERVICE_NAME } from "../lib/index.js";
import { ULID_PATTERN } from "../lib/core.js";

/* ------------------------------- harness ------------------------------ */

const OK_CHUNKS = [
  { type: "block-start", index: 0 },
  { type: "text-delta", text: "hi" },
  { type: "finish", reason: { kind: "stop" } }
];

function chunksOf(chunks) {
  const list = Array.isArray(chunks) ? chunks : [chunks];
  return () => (async function* () {
    for (const chunk of list) yield chunk;
  })();
}

async function collect(iterable) {
  const out = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

/**
 * The identity patch keeps its ref-count on a process-global symbol, so a test
 * that fails before dispose() would leak it and make the next apply() skip the
 * wrapper. Tests that touch globalThis.fetch reset it explicitly.
 */
const IDENTITY_PATCH_KEY = Symbol.for("dsh-plugin.rate-limiter-renew.identityFetch");

function resetIdentityPatch() {
  delete globalThis[IDENTITY_PATCH_KEY];
}

function baseConfig(overrides = {}) {
  return {
    enabled: true,
    requestsPerMinute: 0,
    burst: 1,
    mode: "wait",
    maxWaitMs: 30000,
    upstream429Backoff: true,
    backoffMs: 30000,
    maxBackoffMs: 60000,
    backoffJitter: 0,
    maxConcurrentRequests: 0,
    // Off by default so tests never race a background discovery run.
    autoDetectModels: false,
    detectIntervalMs: 0,
    models: [],
    identityRules: [],
    ...overrides
  };
}

function makeCtx({ llm, settings, webServer } = {}) {
  const log = [];
  const disposers = [];
  const events = new Map();
  const provided = new Map();
  const services = new Map();
  if (llm) services.set("llm", llm);
  if (settings) services.set("settings", settings);
  if (webServer) services.set("webServer", webServer);

  const ctx = {
    logger: {
      info: (message) => log.push(["info", message]),
      warn: (message) => log.push(["warn", message]),
      error: (message) => log.push(["error", message])
    },
    fiber: { id: "test-fiber" },
    llm,
    log,
    events,
    provided,
    on(event, handler, options) {
      events.set(event, { handler, options });
      return () => events.delete(event);
    },
    get(service) {
      return services.get(service);
    },
    provide(serviceName, service) {
      provided.set(serviceName, service);
      return () => provided.delete(serviceName);
    },
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === "function") disposers.push(dispose);
      return dispose;
    },
    // Mirrors Cordis: the callback only runs once every named service exists.
    inject(names, callback) {
      if (!names.every((service) => services.get(service) != null)) return undefined;
      const scoped = {
        ...ctx,
        on: ctx.on,
        effect: ctx.effect,
        get: ctx.get,
        settings: services.get("settings"),
        webServer: services.get("webServer"),
        llm: services.get("llm")
      };
      return callback(scoped);
    },
    dispose() {
      for (const dispose of disposers.splice(0)) dispose();
    }
  };
  return ctx;
}

function makeWebServer() {
  const routes = [];
  return {
    routes,
    register(route) {
      if (routes.some((known) => known.kind === route.kind && known.path === route.path)) {
        throw new Error(`duplicate route ${route.path}`);
      }
      routes.push(route);
      return () => {
        const index = routes.indexOf(route);
        if (index >= 0) routes.splice(index, 1);
      };
    }
  };
}

function makeReq({ method = "POST", body, remoteAddress = "127.0.0.1", host = "127.0.0.1:19387", headers = {} } = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const chunks = text.length > 0 ? [Buffer.from(text, "utf8")] : [];
  const listeners = new Map();
  const req = {
    method,
    headers: { host, "content-type": "application/json", ...headers },
    socket: { remoteAddress },
    on(event, callback) {
      listeners.set(event, callback);
      return req;
    },
    emit(event) {
      listeners.get(event)?.();
    },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  };
  return req;
}

function makeRes() {
  const frames = [];
  const res = {
    status: 0,
    headers: null,
    body: "",
    frames,
    writableEnded: false,
    ended: false,
    writeHead(status, headers) {
      res.status = status;
      res.headers = headers;
      return res;
    },
    write(chunk) {
      frames.push(String(chunk));
      return true;
    },
    end(chunk) {
      if (chunk !== undefined) res.body += String(chunk);
      res.writableEnded = true;
      res.ended = true;
      return res;
    },
    on() {
      return res;
    }
  };
  return res;
}

async function callRoute(webServer, path, options = {}) {
  const route = webServer.routes.find((candidate) => candidate.path === path);
  assert.ok(route, `route ${path} was not registered`);
  const res = makeRes();
  await route.handler(makeReq(options), res);
  return { status: res.status, headers: res.headers, body: JSON.parse(res.body || "{}") };
}

function streamHandler(ctx) {
  const entry = ctx.events.get("llm/stream");
  assert.ok(entry, "the plugin must register an llm/stream interceptor");
  return entry;
}

function fakeLlm(overrides = {}) {
  return {
    async listProviders() {
      return [
        { id: "nvidia", name: "NVIDIA" },
        { id: "openrouter", name: "OpenRouter" }
      ];
    },
    // Tripwires: detection must read only the *added* routes. If the plugin ever
    // consults the dormant-provider directory or the candidate-model discovery
    // again, the throw lands in `errors` and the detection assertions below fail.
    async listConfigurableProviders() {
      throw new Error("the configurable-provider directory must not be consulted");
    },
    async discoverModels() {
      throw new Error("discoverModels must not be consulted");
    },
    async listModels(provider) {
      return provider === "nvidia" ? [{ id: "deepseek-v4.1-flash", name: "V4.1 Flash", contextWindow: 128000 }] : [];
    },
    ...overrides
  };
}

/* -------------------------------- tests ------------------------------- */

test("host: module contract and volatile Config fields", () => {
  assert.equal(name, "dsh-rate-limiter-renew");
  assert.deepEqual(inject, ["llm"]);
  assert.equal(NS, "rate-limiter-renew");
  assert.equal(SERVICE_NAME, "rate-limiter-renew/stats");
  assert.equal(BRIDGE_PREFIX, "/api/dsh-rate-limiter-renew");

  const shape = Config.meta.shape;
  assert.ok(shape, "Config must be an object schema");
  for (const field of Object.keys(shape)) {
    assert.equal(shape[field].meta.volatile, true, `${field} must be declared .volatile() on DSH 0.2.x`);
  }
});

test("host: registers the interceptor, the adapters-updated listener and the stats service", () => {
  const ctx = makeCtx();
  apply(ctx, baseConfig());
  const { options } = streamHandler(ctx);
  assert.equal(options.global, true);
  assert.equal(options.prepend, true);
  assert.ok(ctx.events.has("llm/adapters-updated"), "a topology change must invalidate the model cache");
  const service = ctx.provided.get(SERVICE_NAME);
  assert.ok(service);
  for (const method of ["getStats", "getAllStats", "getAggregateStats", "resetStats", "detectModels"]) {
    assert.equal(typeof service[method], "function", `service.${method} is missing`);
  }
  assert.equal(service.getName(), name);
  assert.equal(service.getNamespace(), NS);
  ctx.dispose();
});

test("host: reject mode answers with a synthetic RATE_LIMIT finish and never calls the adapter", async () => {
  const ctx = makeCtx();
  apply(ctx, baseConfig({ requestsPerMinute: 60, burst: 1, mode: "reject" }));
  const { handler } = streamHandler(ctx);
  let calls = 0;
  const next = () => {
    calls += 1;
    return chunksOf(OK_CHUNKS)();
  };

  const first = await collect(handler({ provider: "nvidia", model: "glm" }, next));
  assert.deepEqual(first, OK_CHUNKS);
  assert.equal(calls, 1);

  const second = await collect(handler({ provider: "nvidia", model: "glm" }, next));
  assert.equal(calls, 1, "the rejected call must never reach the adapter");
  assert.equal(second.length, 1);
  assert.equal(second[0].type, "finish");
  assert.equal(second[0].reason.kind, "error");
  assert.equal(second[0].reason.failure.code, "RATE_LIMIT");
  assert.equal(second[0].reason.failure.status, 429);
  assert.ok(second[0].reason.failure.providerRetryAfterMs >= 1000);
  assert.match(second[0].reason.failure.message, /nvidia\/glm/);

  const service = ctx.provided.get(SERVICE_NAME);
  assert.equal(service.getStats("nvidia", "glm").rejected, 1);
  assert.equal(service.getStats("nvidia", "glm").reserved, 2);
  assert.equal(service.getAggregateStats().routes, 1);
  assert.equal(service.getAllStats()[0].requestsPerMinute, 60);
  assert.equal(service.getStats("other", "model"), null);
  ctx.dispose();
});

test("host: wait mode rejects only when the wait would exceed maxWaitMs", async () => {
  const ctx = makeCtx();
  apply(ctx, baseConfig({ requestsPerMinute: 60, burst: 1, mode: "wait", maxWaitMs: 0 }));
  const { handler } = streamHandler(ctx);
  const next = chunksOf(OK_CHUNKS);
  await collect(handler({ provider: "nvidia", model: "glm" }, next));
  const second = await collect(handler({ provider: "nvidia", model: "glm" }, next));
  assert.equal(second[0].reason.kind, "error");
  assert.equal(second[0].reason.failure.code, "RATE_LIMIT");
  ctx.dispose();
});

test("host: wait mode paces the call instead of dropping it", async () => {
  const ctx = makeCtx();
  // 60000 rpm => one token every 60ms, so the test stays fast.
  apply(ctx, baseConfig({ requestsPerMinute: 60000, burst: 1, mode: "wait", maxWaitMs: 5000 }));
  const { handler } = streamHandler(ctx);
  const next = chunksOf(OK_CHUNKS);
  await collect(handler({ provider: "nvidia", model: "glm" }, next));
  const started = Date.now();
  const second = await collect(handler({ provider: "nvidia", model: "glm" }, next));
  const elapsed = Date.now() - started;
  assert.deepEqual(second, OK_CHUNKS, "a paced call still reaches the adapter");
  assert.ok(elapsed >= 5, `expected the second call to be paced, elapsed=${elapsed}ms`);
  const stats = ctx.provided.get(SERVICE_NAME).getStats("nvidia", "glm");
  assert.equal(stats.waited, 1);
  assert.ok(stats.totalWaitMs > 0);
  ctx.dispose();
});

test("host: aborting a paced call finishes with reason aborted", async () => {
  const ctx = makeCtx();
  apply(ctx, baseConfig({ requestsPerMinute: 60000, burst: 1, mode: "wait", maxWaitMs: 5000 }));
  const { handler } = streamHandler(ctx);
  const next = chunksOf(OK_CHUNKS);
  await collect(handler({ provider: "nvidia", model: "glm" }, next));

  const controller = new AbortController();
  const pending = collect(handler({ provider: "nvidia", model: "glm", signal: controller.signal }, next));
  setTimeout(() => controller.abort(), 2);
  const out = await pending;
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "finish");
  assert.equal(out[0].reason.kind, "aborted");
  assert.equal(out[0].reason.failure.code, "RATE_LIMIT_ABORTED");
  ctx.dispose();
});

test("host: enabled=false passes every call straight through", async () => {
  const ctx = makeCtx();
  apply(ctx, baseConfig({ enabled: false, requestsPerMinute: 60, burst: 1, mode: "reject" }));
  const { handler } = streamHandler(ctx);
  const next = chunksOf(OK_CHUNKS);
  for (let index = 0; index < 5; index += 1) {
    assert.deepEqual(await collect(handler({ provider: "nvidia", model: "glm" }, next)), OK_CHUNKS);
  }
  assert.equal(ctx.provided.get(SERVICE_NAME).getAggregateStats().routes, 0);
  ctx.dispose();
});

test("host: an upstream 429 cools the route, is still forwarded, and gates the next call", async () => {
  const ctx = makeCtx();
  apply(
    ctx,
    baseConfig({ requestsPerMinute: 60, burst: 4, mode: "reject", backoffMs: 30000, maxBackoffMs: 60000, backoffJitter: 0 })
  );
  const { handler } = streamHandler(ctx);
  const failure = { message: "upstream said 429", code: "rate_limit", status: 429, providerRetryAfterMs: 20000 };
  const finish = { type: "finish", reason: { kind: "error", failure } };

  const forward = await collect(handler({ provider: "nvidia", model: "glm" }, chunksOf(finish)));
  assert.equal(forward.length, 1);
  assert.equal(forward[0], finish, "dsh-llm-retry must still see the 429 finish");

  const stats = ctx.provided.get(SERVICE_NAME).getStats("nvidia", "glm");
  assert.equal(stats.consecutiveFails, 1);
  assert.ok(stats.coolMs > 19000 && stats.coolMs <= 20000, `Retry-After should win, coolMs=${stats.coolMs}`);

  let calls = 0;
  const next = () => {
    calls += 1;
    return chunksOf(OK_CHUNKS)();
  };
  const gated = await collect(handler({ provider: "nvidia", model: "glm" }, next));
  assert.equal(calls, 0, "the cooled route must not reach the adapter");
  assert.equal(gated[0].reason.failure.code, "RATE_LIMIT");
  ctx.dispose();
});

test("host: a success resets the 429 failure streak", async () => {
  const ctx = makeCtx();
  apply(ctx, baseConfig({ upstream429Backoff: true, backoffMs: 1000, maxBackoffMs: 3600000, backoffJitter: 0 }));
  const { handler } = streamHandler(ctx);
  const first = { type: "finish", reason: { kind: "error", failure: { status: 429 } } };
  const second = { type: "finish", reason: { kind: "error", failure: { status: 429 } } };
  await collect(handler({ provider: "p", model: "m" }, chunksOf(first)));
  await collect(handler({ provider: "p", model: "m" }, chunksOf(second)));
  const service = ctx.provided.get(SERVICE_NAME);
  assert.equal(service.getStats("p", "m").consecutiveFails, 2);
  await collect(handler({ provider: "p", model: "m" }, chunksOf(OK_CHUNKS)));
  assert.equal(service.getStats("p", "m").consecutiveFails, 0);
  assert.equal(service.resetStats("p", "m"), true);
  assert.equal(service.getStats("p", "m").reserved, 0);
  assert.equal(service.resetStats("p", "missing"), false);
  assert.equal(service.resetStats(), true);
  ctx.dispose();
});

test("host: maxConcurrentRequests serialises in-flight calls", async () => {
  const ctx = makeCtx();
  apply(ctx, baseConfig({ maxConcurrentRequests: 1 }));
  const { handler } = streamHandler(ctx);
  const order = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const slow = async function* () {
    order.push("slow-start");
    await gate;
    order.push("slow-end");
    yield OK_CHUNKS[2];
  };
  const fast = async function* () {
    order.push("fast-start");
    yield OK_CHUNKS[2];
  };

  const first = collect(handler({ provider: "a", model: "b" }, () => slow()));
  await new Promise((resolve) => setImmediate(resolve));
  const second = collect(handler({ provider: "a", model: "b" }, () => fast()));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["slow-start"], "the second call must queue behind the concurrency slot");

  release();
  await first;
  await second;
  assert.deepEqual(order, ["slow-start", "slow-end", "fast-start"]);
  assert.equal(ctx.provided.get(SERVICE_NAME).getStats("a", "b").activeCount, 0);
  ctx.dispose();
});

test("host: gateway identity rules rewrite the outbound request", async () => {
  const seen = [];
  const native = async (input, init) => {
    seen.push({ input, init });
    return { ok: true };
  };
  const originalFetch = globalThis.fetch;
  resetIdentityPatch();
  globalThis.fetch = native;
  const ctx = makeCtx();
  try {
    apply(
      ctx,
      baseConfig({
        identityRules: [
          {
            urlPattern: "opencode.ai/zen",
            userAgent: "UA-TEST",
            dynamicIds: true,
            headers: [{ name: "x-custom", value: "1" }],
            enabled: true
          }
        ]
      })
    );
    assert.notEqual(globalThis.fetch, native, "the wrapper must actually be installed");

    await fetch("https://opencode.ai/zen/v1/chat/completions", { method: "POST", headers: { "user-agent": "original" } });
    assert.equal(seen.length, 1);
    const headers = new Headers(seen[0].init.headers);
    assert.equal(headers.get("user-agent"), "UA-TEST");
    assert.equal(headers.get("x-custom"), "1");
    assert.equal(headers.get("x-opencode-client"), "cli");
    assert.equal(headers.get("x-opencode-project"), "global");
    const session = headers.get("x-opencode-session");
    const request = headers.get("x-opencode-request");
    assert.match(session, /^ses_[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.match(request, /^msg_[0-9A-HJKMNP-TV-Z]{26}$/);

    // A second matching call keeps the session id (stable per plugin instance)
    // but gets a fresh per-request id.
    await fetch("https://opencode.ai/zen/v1/models", { headers: { "user-agent": "original" } });
    const second = new Headers(seen[1].init.headers);
    assert.equal(second.get("x-opencode-session"), session);
    assert.notEqual(second.get("x-opencode-request"), request);

    // Request objects take the copy-through branch.
    await fetch(new Request("https://opencode.ai/zen/v1/models", { headers: { "user-agent": "orig-2" } }));
    assert.equal(seen.length, 3);
    assert.ok(seen[2].input instanceof Request);
    assert.equal(new Headers(seen[2].input.headers).get("user-agent"), "UA-TEST");

    // A non-matching URL is passed through untouched.
    await fetch("https://example.com/other");
    assert.equal(seen.length, 4);
    assert.equal(new Headers(seen[3].init?.headers ?? {}).get("user-agent"), null);
    assert.equal(seen[3].init, undefined);
  } finally {
    ctx.dispose();
    globalThis.fetch = originalFetch;
  }
  assert.equal(globalThis.fetch, originalFetch, "dispose must restore the native fetch");
  assert.equal(globalThis[IDENTITY_PATCH_KEY], undefined, "dispose must release the patch ref-count");
});

test("host: identity rules can be disabled without touching the URL matcher", async () => {
  const seen = [];
  const native = async (input, init) => {
    seen.push({ input, init });
    return { ok: true };
  };
  const originalFetch = globalThis.fetch;
  resetIdentityPatch();
  globalThis.fetch = native;
  const ctx = makeCtx();
  try {
    apply(
      ctx,
      baseConfig({ identityRules: [{ urlPattern: "opencode.ai/zen", userAgent: "UA", enabled: false }] })
    );
    await fetch("https://opencode.ai/zen/v1/chat", { headers: { "user-agent": "original" } });
    assert.equal(new Headers(seen[0].init.headers).get("user-agent"), "original");
    assert.equal(new Headers(seen[0].init.headers).get("x-opencode-client"), null);
  } finally {
    ctx.dispose();
    globalThis.fetch = originalFetch;
  }
});

test("host: /models auto-detects only the user's added providers and models", async () => {
  const webServer = makeWebServer();
  const ctx = makeCtx({ llm: fakeLlm(), webServer });
  apply(ctx, baseConfig({ autoDetectModels: true, detectIntervalMs: 60000 }));

  const { body } = await callRoute(webServer, `${BRIDGE_PREFIX}/models`, { body: { force: true } });
  assert.equal(body.ok, true);
  assert.deepEqual(body.value.errors, []);
  assert.deepEqual(
    body.value.providers.map((provider) => provider.id),
    ["nvidia", "openrouter"]
  );

  const nvidia = body.value.providers.find((provider) => provider.id === "nvidia");
  assert.deepEqual(nvidia.models.map((model) => model.id), ["deepseek-v4.1-flash"]);
  assert.deepEqual(nvidia.sources, ["adapter", "listModels"]);
  assert.equal(nvidia.models[0].contextWindow, 128000);

  // A provider that reported nothing usable is still listed, with no models.
  assert.deepEqual(body.value.providers.find((provider) => provider.id === "openrouter").models, []);

  const snapshot = await callRoute(webServer, `${BRIDGE_PREFIX}/stats`, { body: {} });
  assert.equal(snapshot.body.value.detected.providers, 2);
  assert.equal(snapshot.body.value.detected.models, 1);

  const service = ctx.provided.get(SERVICE_NAME);
  const detected = await service.detectModels({ force: true });
  assert.deepEqual(detected.map((provider) => provider.id), ["nvidia", "openrouter"]);
  assert.deepEqual(service.getDetectedModels(), detected);
  ctx.dispose();
});

test("host: a failing provider is reported, not thrown", async () => {
  const webServer = makeWebServer();
  const llm = fakeLlm({
    async listModels(provider) {
      if (provider === "nvidia") throw new Error("upstream probe failed");
      return [];
    }
  });
  const ctx = makeCtx({ llm, webServer });
  apply(ctx, baseConfig({ autoDetectModels: true, detectIntervalMs: 60000 }));
  const { body } = await callRoute(webServer, `${BRIDGE_PREFIX}/models`, { body: { force: true } });
  assert.equal(body.ok, true);
  assert.equal(body.value.errors.length, 1);
  assert.equal(body.value.errors[0].where, "listModels:nvidia");
  assert.match(body.value.errors[0].message, /upstream probe failed/);
  ctx.dispose();
});

test("host: the bridge is loopback-only and streams a snapshot frame first", async () => {
  const webServer = makeWebServer();
  const ctx = makeCtx({ webServer });
  apply(ctx, baseConfig());

  const denied = await callRoute(webServer, `${BRIDGE_PREFIX}/stats`, { body: {}, remoteAddress: "10.1.2.3" });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "untrusted-request");

  const crossSite = await callRoute(webServer, `${BRIDGE_PREFIX}/stats`, {
    body: {},
    headers: { "sec-fetch-site": "cross-site" }
  });
  assert.equal(crossSite.status, 403);

  const rebound = await callRoute(webServer, `${BRIDGE_PREFIX}/stats`, { body: {}, host: "evil.example.com" });
  assert.equal(rebound.status, 403);

  const wrongMethod = await callRoute(webServer, `${BRIDGE_PREFIX}/stats`, { method: "GET" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.code, "method-not-allowed");

  const malformed = await callRoute(webServer, `${BRIDGE_PREFIX}/stats`, { body: undefined });
  assert.equal(malformed.status, 200);
  assert.equal(malformed.body.ok, true, "an empty body is treated as {}");

  const events = webServer.routes.find((route) => route.path === `${BRIDGE_PREFIX}/events`);
  const res = makeRes();
  const req = makeReq({ method: "GET" });
  events.handler(req, res);
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "text/event-stream; charset=utf-8");
  assert.match(res.frames[0], /^event: snapshot\ndata: \{"ok":true/);

  ctx.dispose();
  assert.equal(res.ended, true, "dispose must close open SSE streams");
});

test("host: the settings bridge reads and writes the namespace", async () => {
  const calls = [];
  const settings = {
    writable: true,
    configure(presentation, fiber) {
      calls.push(["configure", presentation, Boolean(fiber)]);
      return () => {};
    },
    describe(options) {
      calls.push(["describe", options]);
      return [
        { ns: "some-other-plugin", value: {}, revision: 1, autoGenerate: true, applies: "live" },
        { ns: NS, value: { burst: 4, mode: "wait" }, revision: 7, autoGenerate: false, applies: "live" }
      ];
    },
    async replace(ns, section, revision) {
      calls.push(["replace", ns, section, revision]);
    },
    async mutate(ns, ops, revision) {
      calls.push(["mutate", ns, ops, revision]);
    }
  };
  const webServer = makeWebServer();
  const ctx = makeCtx({ settings, webServer });
  apply(ctx, baseConfig());

  // The plugin owns its settings page, so it must claim `auto: false`.
  assert.deepEqual(calls[0], ["configure", { auto: false }, true]);

  const described = await callRoute(webServer, `${BRIDGE_PREFIX}/describe`, { body: {} });
  assert.equal(described.body.ok, true);
  assert.equal(described.body.value.ns, NS);
  assert.equal(described.body.value.revision, 7);
  assert.equal(described.body.value.writable, true);
  assert.equal(described.body.value.autoGenerate, false);
  assert.deepEqual(described.body.value.value, { burst: 4, mode: "wait" });
  assert.equal(calls.find((call) => call[0] === "describe")[1].redactSecrets, true);

  const replaced = await callRoute(webServer, `${BRIDGE_PREFIX}/replace`, {
    body: { section: { burst: 9 }, expectedRevision: 7 }
  });
  assert.equal(replaced.body.ok, true);
  // The handler re-describes the namespace after writing, so filter by verb.
  assert.deepEqual(calls.filter((call) => call[0] === "replace").at(-1), ["replace", NS, { burst: 9 }, 7]);

  const mutated = await callRoute(webServer, `${BRIDGE_PREFIX}/mutate`, {
    body: { ops: [{ op: "set", path: ["burst"], value: 3 }], expectedRevision: 8 }
  });
  assert.equal(mutated.body.ok, true);
  assert.deepEqual(calls.filter((call) => call[0] === "mutate").at(-1), ["mutate", NS, [{ op: "set", path: ["burst"], value: 3 }], 8]);

  const badOps = await callRoute(webServer, `${BRIDGE_PREFIX}/mutate`, { body: { ops: "nope" } });
  assert.equal(badOps.body.ok, false);
  assert.equal(badOps.body.code, "settings-rejected");

  const badSection = await callRoute(webServer, `${BRIDGE_PREFIX}/replace`, { body: { section: 42 } });
  assert.equal(badSection.body.code, "settings-rejected");

  const reset = await callRoute(webServer, `${BRIDGE_PREFIX}/reset`, { body: {} });
  assert.equal(reset.body.ok, true);
  assert.deepEqual(calls.filter((call) => call[0] === "replace").at(-1), ["replace", NS, {}, undefined]);

  settings.replace = async () => {
    throw new SettingsConflictError("revision conflict");
  };
  const conflict = await callRoute(webServer, `${BRIDGE_PREFIX}/replace`, { body: { section: {} } });
  assert.equal(conflict.body.ok, false);
  assert.equal(conflict.body.code, "settings-conflict");

  ctx.dispose();
});

test("host: without a settings service the bridge reports it instead of crashing", async () => {
  const webServer = makeWebServer();
  const ctx = makeCtx({ webServer });
  apply(ctx, baseConfig());
  const described = await callRoute(webServer, `${BRIDGE_PREFIX}/describe`, { body: {} });
  assert.equal(described.body.ok, false);
  assert.equal(described.body.code, "settings-absent");
  const mutated = await callRoute(webServer, `${BRIDGE_PREFIX}/mutate`, { body: { ops: [] } });
  assert.equal(mutated.body.code, "settings-absent");
  ctx.dispose();
});

test("host: an unregistered settings namespace is reported, not silently empty", async () => {
  const webServer = makeWebServer();
  const ctx = makeCtx({
    settings: {
      writable: true,
      configure: () => () => {},
      describe: () => [{ ns: "someone-else", value: {}, revision: 1 }],
      async replace() {},
      async mutate() {}
    },
    webServer
  });
  apply(ctx, baseConfig());
  const described = await callRoute(webServer, `${BRIDGE_PREFIX}/describe`, { body: {} });
  assert.equal(described.body.ok, false);
  assert.equal(described.body.code, "settings-not-exposed");
  assert.match(described.body.message, /rate-limiter-renew/);
  ctx.dispose();
});

test("host: llm/adapters-updated invalidates the cached detection", async () => {
  const webServer = makeWebServer();
  let calls = 0;
  const llm = fakeLlm({
    async listProviders() {
      calls += 1;
      return [{ id: "nvidia", name: "NVIDIA" }];
    }
  });
  const ctx = makeCtx({ llm, webServer });
  apply(ctx, baseConfig({ autoDetectModels: true, detectIntervalMs: 600000 }));
  await callRoute(webServer, `${BRIDGE_PREFIX}/models`, { body: { force: true } });
  const detected = calls;
  assert.ok(detected >= 1, "a forced probe must reach listProviders");
  // Inside the TTL a non-forced probe is served from cache...
  await callRoute(webServer, `${BRIDGE_PREFIX}/models`, { body: {} });
  await callRoute(webServer, `${BRIDGE_PREFIX}/models`, { body: {} });
  assert.equal(calls, detected);
  // ...but a topology change must force a fresh read.
  ctx.events.get("llm/adapters-updated").handler();
  await new Promise((resolve) => setImmediate(resolve));
  await callRoute(webServer, `${BRIDGE_PREFIX}/models`, { body: { force: true } });
  assert.ok(calls > detected, "an adapters-updated event must invalidate the cache");
  ctx.dispose();
});

test("host: a garbage detection result still produces a usable snapshot", async () => {
  const webServer = makeWebServer();
  const llm = {
    async listProviders() {
      return [null, { id: "" }, { id: "nvidia" }];
    },
    async listModels() {
      return [null, { id: "" }];
    }
  };
  const ctx = makeCtx({ llm, webServer });
  apply(ctx, baseConfig({ autoDetectModels: true, detectIntervalMs: 60000 }));
  const { body } = await callRoute(webServer, `${BRIDGE_PREFIX}/models`, { body: { force: true } });
  assert.deepEqual(body.value.providers.map((provider) => provider.id), ["nvidia"]);
  assert.deepEqual(body.value.providers[0].models, []);
  ctx.dispose();
});

test("host: per-route overrides beat the global limit", async () => {
  const ctx = makeCtx();
  apply(
    ctx,
    baseConfig({
      mode: "reject",
      requestsPerMinute: 0,
      burst: 1,
      models: [{ provider: "nvidia", model: "glm", requestsPerMinute: 60, burst: 1 }]
    })
  );
  const { handler } = streamHandler(ctx);
  const next = chunksOf(OK_CHUNKS);
  // Unlisted routes are unlimited.
  for (let index = 0; index < 4; index += 1) {
    assert.deepEqual(await collect(handler({ provider: "openrouter", model: "x" }, next)), OK_CHUNKS);
  }
  // The overridden route is not.
  await collect(handler({ provider: "nvidia", model: "glm" }, next));
  const rejected = await collect(handler({ provider: "nvidia", model: "glm" }, next));
  assert.equal(rejected[0].reason.failure.code, "RATE_LIMIT");
  const stats = ctx.provided.get(SERVICE_NAME).getAllStats();
  assert.equal(stats.length, 2);
  assert.equal(stats.find((route) => route.provider === "nvidia").requestsPerMinute, 60);
  assert.equal(stats.find((route) => route.provider === "openrouter").unlimited, true);
  ctx.dispose();
});

test("host: scope=all limits every route, including ones with no override row", async () => {
  const ctx = makeCtx();
  apply(ctx, baseConfig({ scope: "all", mode: "reject", requestsPerMinute: 60, burst: 1, models: [] }));
  const { handler } = streamHandler(ctx);
  const next = chunksOf(OK_CHUNKS);
  await collect(handler({ provider: "openrouter", model: "x" }, next));
  const rejected = await collect(handler({ provider: "openrouter", model: "x" }, next));
  assert.equal(rejected[0].type, "finish");
  assert.equal(rejected[0].reason.failure.code, "RATE_LIMIT");
  assert.equal(ctx.provided.get(SERVICE_NAME).getAllStats().length, 1);
  ctx.dispose();
});

test("host: scope=overrides limits only routes that have an override row", async () => {
  const ctx = makeCtx();
  apply(
    ctx,
    baseConfig({
      scope: "overrides",
      mode: "reject",
      requestsPerMinute: 60,
      burst: 1,
      models: [{ provider: "nvidia", model: "glm", requestsPerMinute: 60, burst: 1 }]
    })
  );
  const { handler } = streamHandler(ctx);
  const next = chunksOf(OK_CHUNKS);

  // No override row -> out of scope -> passes through and is never even counted.
  for (let index = 0; index < 6; index += 1) {
    assert.deepEqual(await collect(handler({ provider: "openrouter", model: "x" }, next)), OK_CHUNKS);
  }
  assert.equal(ctx.provided.get(SERVICE_NAME).getStats("openrouter", "x"), null);

  // ... while the route that does have a row is still throttled.
  await collect(handler({ provider: "nvidia", model: "glm" }, next));
  const rejected = await collect(handler({ provider: "nvidia", model: "glm" }, next));
  assert.equal(rejected[0].reason.failure.code, "RATE_LIMIT");

  const routes = ctx.provided.get(SERVICE_NAME).getAllStats();
  assert.deepEqual(routes.map((route) => `${route.provider}/${route.model}`), ["nvidia/glm"]);
  ctx.dispose();
});

test("host: switching to scope=overrides drops buckets that are now out of scope", async () => {
  const ctx = makeCtx();
  const config = baseConfig({ mode: "wait", requestsPerMinute: 0, burst: 1, models: [] });
  apply(ctx, config);
  const { handler } = streamHandler(ctx);
  const service = ctx.provided.get(SERVICE_NAME);
  await collect(handler({ provider: "openrouter", model: "x" }, chunksOf(OK_CHUNKS)));
  assert.equal(service.getAllStats().length, 1);

  // A live config edit (what the settings bridge does through the namespace):
  // the route has no override row anymore, so its stale bucket must be pruned.
  config.scope = "overrides";
  assert.deepEqual(service.getAllStats(), []);
  assert.equal(service.getStats("openrouter", "x"), null);
  ctx.dispose();
});

test("host: the ULID helpers used by the identity patch are standards-compliant", () => {
  const session = `ses_${"01ARZ3NDEKTSV4RRFFQ69G5FAV"}`;
  assert.match(session.slice(4), ULID_PATTERN);
});
