/**
 * Unit tests for the framework-free core. No DeepSeek Harness import is
 * involved, so `node --test test/core.test.mjs` runs on any Node 20+ runtime.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ULID_PATTERN,
  TokenBucket,
  acquireConcurrencySlot,
  backoffDelayMs,
  delay,
  detectedRouteKeys,
  diffOps,
  limitFor,
  mergeDetection,
  normalizeConfig,
  parseHeaderList,
  rateLimitFailure,
  releaseConcurrencySlot,
  resolveConfig,
  routeLimits,
  ulid,
  validateOps,
  DEFAULT_CONFIG
} from "../lib/core.js";

/* ------------------------------- ULID ------------------------------- */

test("ulid: 26 Crockford chars, unique, monotonic time prefix", () => {
  const ids = new Set();
  for (let i = 0; i < 500; i += 1) {
    const id = ulid();
    assert.match(id, ULID_PATTERN);
    assert.equal(id.length, 26);
    assert.ok(!ids.has(id), `duplicate ulid: ${id}`);
    ids.add(id);
  }
  const a = ulid();
  const b = ulid();
  assert.equal(a.slice(0, 10), b.slice(0, 10));
  assert.notEqual(a.slice(10), b.slice(10));
});

test("delay: resolves true after the timeout, false when aborted", async () => {
  assert.equal(await delay(5), true);
  assert.equal(await delay(0), true);

  const controller = new AbortController();
  const pending = delay(50, controller.signal);
  controller.abort();
  assert.equal(await pending, false);

  assert.equal(await delay(50, controller.signal), false);
});

/* ---------------------------- token bucket --------------------------- */

test("token bucket: burst is instant, then paced one interval apart", () => {
  const bucket = new TokenBucket(3, 60, 0); // 60/s => one token every 1000ms
  assert.equal(bucket.intervalMs, 1000);
  assert.equal(bucket.reserve(0), 0); // the whole burst goes out at once
  assert.equal(bucket.reserve(0), 0);
  assert.equal(bucket.reserve(0), 0);
  assert.equal(bucket.reserve(0), 1000); // burst already spent
  assert.equal(bucket.reserve(0), 2000);
  assert.equal(bucket.waited, 2);
  assert.equal(bucket.reserved, 5);
  assert.equal(bucket.totalWaitMs, 3000);
});

test("token bucket: an idle bucket recovers its burst but never more", () => {
  const bucket = new TokenBucket(3, 60, 0);
  bucket.reserve(0);
  bucket.reserve(0);
  assert.equal(bucket.peekWait(10000), 0);
  assert.equal(bucket.reserve(10000), 0);
  assert.equal(bucket.reserve(10000), 0);
  assert.equal(bucket.reserve(10000), 0);
  assert.equal(bucket.reserve(10000), 1000);
});

test("token bucket: peekWait never advances the pace", () => {
  const bucket = new TokenBucket(1, 60, 0);
  assert.equal(bucket.peekWait(0), 0);
  assert.equal(bucket.peekWait(0), 0);
  assert.equal(bucket.reserve(0), 0);
  assert.equal(bucket.peekWait(0), 1000);
});

test("token bucket: rpm 0 is the explicit unlimited sentinel", () => {
  const bucket = new TokenBucket(4, 0, 0);
  assert.equal(bucket.unlimited, true);
  for (let i = 0; i < 50; i += 1) assert.equal(bucket.reserve(0), 0);
  assert.equal(bucket.peekWait(0), 0);
  assert.equal(bucket.waited, 0);
});

test("token bucket: cool() gates the whole route (upstream 429)", () => {
  const bucket = new TokenBucket(4, 60, 0);
  bucket.cool(5000, 0);
  assert.equal(bucket.peekWait(0), 5000);
  assert.equal(bucket.reserve(0), 5000);
  // The 429 cool-down and the normal pace both advance the next slot.
  assert.equal(bucket.peekWait(5000), 1000);

  const wider = new TokenBucket(4, 60, 0);
  wider.cool(5000, 0);
  wider.cool(1000, 0); // a shorter cool-down must never shorten the current one
  assert.equal(wider.coolUntil, 5000);
});

test("token bucket: retune keeps the pace and never hands out a free burst", () => {
  const bucket = new TokenBucket(4, 60, 0);
  for (let i = 0; i < 4; i += 1) assert.equal(bucket.reserve(0), 0); // spend the burst
  const before = bucket.next;
  assert.equal(before, 1000, "the 5th call is the first one that has to wait");
  bucket.retune(2, 60, 0);
  assert.equal(bucket.capacity, 2);
  assert.equal(bucket.next, Math.max(before, -1000));
  assert.ok(bucket.next >= before, "retune must not move the next slot earlier than the queued pace");
  bucket.retune(4, 0, 0);
  assert.equal(bucket.unlimited, true);
  assert.equal(bucket.intervalMs, 0);
  assert.equal(bucket.reserve(0), 0);
});

test("token bucket: stats and resetStats", () => {
  const bucket = new TokenBucket(2, 60, 0);
  assert.equal(bucket.reserve(0), 0);
  assert.equal(bucket.reserve(0), 0);
  assert.equal(bucket.reserve(0), 1000, "the burst is gone after `capacity` calls");
  bucket.markRejected();
  const stats = bucket.getStats(0);
  assert.equal(stats.capacity, 2);
  assert.equal(stats.reserved, 3);
  assert.equal(stats.rejected, 1);
  assert.equal(stats.waited, 1);
  assert.equal(stats.totalWaitMs, 1000);
  assert.ok(stats.avgWaitMs > 0);
  bucket.resetStats();
  assert.equal(bucket.getStats(0).reserved, 0);
});

/* ---------------------------- concurrency ---------------------------- */

test("concurrency gate: FIFO, unlimited when max <= 0", async () => {
  const bucket = new TokenBucket(10, 60, 0);
  assert.equal(await acquireConcurrencySlot(bucket, 0), true);

  const first = await acquireConcurrencySlot(bucket, 1);
  assert.equal(first, true);
  assert.equal(bucket.activeCount, 1);

  const order = [];
  const second = acquireConcurrencySlot(bucket, 1).then((ok) => order.push(`second:${ok}`));
  const third = acquireConcurrencySlot(bucket, 1).then((ok) => order.push(`third:${ok}`));
  assert.equal(bucket.queuedNow, 2);

  releaseConcurrencySlot(bucket);
  await second;
  releaseConcurrencySlot(bucket);
  await third;
  assert.deepEqual(order, ["second:true", "third:true"]);
  assert.equal(bucket.activeCount, 1);
  releaseConcurrencySlot(bucket);
  assert.equal(bucket.activeCount, 0);
  assert.equal(bucket.queuedNow, 0);
});

test("concurrency gate: an aborted waiter leaves the queue", async () => {
  const bucket = new TokenBucket(10, 60, 0);
  await acquireConcurrencySlot(bucket, 1);
  const controller = new AbortController();
  const queued = acquireConcurrencySlot(bucket, 1, controller.signal);
  assert.equal(bucket.queuedNow, 1);
  controller.abort();
  assert.equal(await queued, false);
  assert.equal(bucket.queuedNow, 0);
  assert.equal(bucket.activeCount, 1);
  releaseConcurrencySlot(bucket);
  assert.equal(bucket.activeCount, 0);
});

/* ------------------------------- config ------------------------------ */

test("resolveConfig: unwraps live .volatile() refs", () => {
  const config = { enabled: { get: () => false }, burst: 7, models: { get: () => [] } };
  assert.deepEqual(resolveConfig(config), { enabled: false, burst: 7, models: [] });
  assert.deepEqual(resolveConfig(undefined), {});
});

test("normalizeConfig: rpm 0 stays unlimited, negatives and junk fall back", () => {
  const cfg = normalizeConfig({ requestsPerMinute: 0 });
  assert.equal(cfg.requestsPerMinute, 0);
  assert.equal(normalizeConfig({ requestsPerMinute: -5 }).requestsPerMinute, DEFAULT_CONFIG.requestsPerMinute);
  assert.equal(normalizeConfig({ requestsPerMinute: "abc" }).requestsPerMinute, DEFAULT_CONFIG.requestsPerMinute);
  assert.equal(normalizeConfig({}).burst, DEFAULT_CONFIG.burst);
  assert.equal(normalizeConfig({ burst: 0 }).burst, 1);
  assert.equal(normalizeConfig({ mode: "nonsense" }).mode, "wait");
  assert.equal(normalizeConfig({ mode: "reject" }).mode, "reject");
  assert.equal(normalizeConfig({ backoffJitter: 5 }).backoffJitter, 1);
  assert.equal(normalizeConfig({ backoffJitter: -5 }).backoffJitter, 0);
  assert.equal(normalizeConfig({ enabled: false }).enabled, false);
  assert.equal(DEFAULT_CONFIG.scope, "all");
  assert.equal(normalizeConfig({}).scope, "all");
  assert.equal(normalizeConfig({ scope: "overrides" }).scope, "overrides");
  // There is no "off" scope: turning the limiter off is `enabled: false`.
  assert.equal(normalizeConfig({ scope: "off" }).scope, "all");
  assert.equal(normalizeConfig({ scope: "nonsense" }).scope, "all");
  assert.equal(normalizeConfig({ maxConcurrentRequests: 2.7 }).maxConcurrentRequests, 2);
  assert.equal(normalizeConfig({ maxWaitMs: -1 }).maxWaitMs, 0);
  assert.deepEqual(normalizeConfig({}).models, []);
});

test("normalizeConfig: drops empty identity rules and keeps headers", () => {
  const cfg = normalizeConfig({
    identityRules: [
      { urlPattern: "", userAgent: "x" },
      { urlPattern: "opencode.ai/zen", userAgent: "ua", dynamicIds: true, headers: [{ name: "a", value: "b" }, { name: "" }] }
    ]
  });
  assert.equal(cfg.identityRules.length, 1);
  assert.equal(cfg.identityRules[0].urlPattern, "opencode.ai/zen");
  assert.equal(cfg.identityRules[0].dynamicIds, true);
  assert.equal(cfg.identityRules[0].enabled, true);
  assert.deepEqual(cfg.identityRules[0].headers, [{ name: "a", value: "b" }]);
});

test("limitFor: exact wins, then provider-wide, then global, then substring", () => {
  const global = { provider: "", model: "", requestsPerMinute: 10, burst: 1 };
  const providerWide = { provider: "nvidia", model: "", requestsPerMinute: 20, burst: 2 };
  const exact = { provider: "nvidia", model: "glm", requestsPerMinute: 30, burst: 3 };
  const rows = [global, providerWide, exact];

  assert.equal(limitFor(rows, "nvidia", "glm"), exact);
  assert.equal(limitFor(rows, "nvidia", "other"), providerWide);
  assert.equal(limitFor(rows, "openrouter", "whatever"), global);
  assert.equal(limitFor([], "a", "b"), null);

  const fuzzy = [
    { provider: "nvidia", model: "", requestsPerMinute: 1, burst: 1 },
    { provider: "nvidia", model: "flash", requestsPerMinute: 2, burst: 2 }
  ];
  // Most specific substring pattern wins when no exact row matches.
  assert.equal(limitFor(fuzzy, "nvidia", "deepseek-v4.1-flash").requestsPerMinute, 2);
  assert.equal(limitFor(fuzzy, "nvidia-extra", "glm").requestsPerMinute, 1);
  assert.equal(limitFor(fuzzy, "other", "glm"), null);
});

test("routeLimits: scope \"overrides\" leaves unmatched routes unlimited", () => {
  const rows = [{ provider: "nvidia", model: "glm", requestsPerMinute: 30, burst: 3 }];
  const all = normalizeConfig({ scope: "all", requestsPerMinute: 12, burst: 2, models: rows });
  const overrides = normalizeConfig({ scope: "overrides", requestsPerMinute: 12, burst: 2, models: rows });

  // "all" limits everything; an override row still wins where it matches.
  assert.deepEqual(routeLimits(all, "nvidia", "glm"), { capacity: 3, perMinute: 30, perSecond: 0.5 });
  assert.deepEqual(routeLimits(all, "openrouter", "x"), { capacity: 2, perMinute: 12, perSecond: 0.2 });

  // "overrides" limits the routed pair and passes everything else straight through.
  assert.deepEqual(routeLimits(overrides, "nvidia", "glm"), { capacity: 3, perMinute: 30, perSecond: 0.5 });
  assert.equal(routeLimits(overrides, "openrouter", "x"), null);

  // A provider-wide row counts as an override for every model under it.
  const wide = normalizeConfig({ scope: "overrides", models: [{ provider: "nvidia", model: "", requestsPerMinute: 7 }] });
  assert.equal(routeLimits(wide, "nvidia", "anything").perMinute, 7);
  assert.equal(routeLimits(wide, "other", "anything"), null);

  // rpm 0 is a real unlimited-in-scope route, not "out of scope".
  const unlimited = normalizeConfig({ scope: "all", requestsPerMinute: 0, models: [] });
  assert.deepEqual(routeLimits(unlimited, "a", "b"), { capacity: 4, perMinute: 0, perSecond: 0 });

  // Junk config falls back to the defaults instead of throwing.
  assert.equal(routeLimits(null, "a", "b").perMinute, 20);
  assert.equal(routeLimits({ models: "nope" }, "a", "b").perMinute, 20);
});

/* ------------------------------- backoff ----------------------------- */
test("backoffDelayMs: Retry-After wins, otherwise exponential up to the cap", () => {
  const cfg = { backoffMs: 1000, maxBackoffMs: 8000, backoffJitter: 0 };
  const bucket = { consecutiveFails: 0 };
  assert.equal(backoffDelayMs(bucket, cfg, 12345), 12345);
  assert.equal(backoffDelayMs(bucket, cfg), 1000);
  bucket.consecutiveFails = 1;
  assert.equal(backoffDelayMs(bucket, cfg), 2000);
  bucket.consecutiveFails = 3;
  assert.equal(backoffDelayMs(bucket, cfg), 8000);
  bucket.consecutiveFails = 40;
  assert.equal(backoffDelayMs(bucket, cfg), 8000);
  assert.equal(backoffDelayMs(bucket, cfg, 0), 8000);
  assert.equal(backoffDelayMs(bucket, cfg, Number.NaN), 8000);
});

test("backoffDelayMs: jitter stays inside the configured band", () => {
  const cfg = { backoffMs: 1000, maxBackoffMs: 60000, backoffJitter: 0.5 };
  const low = backoffDelayMs({ consecutiveFails: 0 }, cfg, 0, () => 0);
  const high = backoffDelayMs({ consecutiveFails: 0 }, cfg, 0, () => 1);
  assert.equal(low, 500);
  assert.equal(high, 1500);
  const noJitter = backoffDelayMs({ consecutiveFails: 0 }, { ...cfg, backoffJitter: 0 }, 0, () => 1);
  assert.equal(noJitter, 1000);
});

test("rateLimitFailure: RATE_LIMIT / 429 with a retry hint", () => {
  const failure = rateLimitFailure("nvidia", "glm", 20, 4500);
  assert.equal(failure.code, "RATE_LIMIT");
  assert.equal(failure.status, 429);
  assert.equal(failure.providerRetryAfterMs, 4500);
  assert.match(failure.message, /nvidia\/glm/);
  assert.equal(rateLimitFailure("a", "b", 20, 10).providerRetryAfterMs, 1000);
});

/* --------------------------- settings ops ---------------------------- */

test("validateOps: accepts set/unset, rejects malformed payloads", () => {
  assert.deepEqual(validateOps([{ op: "set", path: ["burst"], value: 9 }]), [{ op: "set", path: ["burst"], value: 9 }]);
  assert.deepEqual(validateOps([{ op: "unset", path: ["mode"] }]), [{ op: "unset", path: ["mode"] }]);
  assert.equal(validateOps("nope"), null);
  assert.equal(validateOps([{ op: "set", path: [] }]), null);
  assert.equal(validateOps([{ op: "set", path: [7] }]), null);
  assert.equal(validateOps([{ op: "remove", path: ["x"] }]), null);
  assert.equal(validateOps([{ op: "set", path: ["x"] }]), null);
});

test("diffOps: only changed whole fields, defaults become unset", () => {
  const ops = diffOps({ requestsPerMinute: 20, burst: 8 }, { requestsPerMinute: 20, burst: 12 });
  assert.deepEqual(ops, [{ op: "set", path: ["burst"], value: 12 }]);

  const unset = diffOps({ requestsPerMinute: 30, burst: 8 }, { requestsPerMinute: 20, burst: 8 });
  assert.deepEqual(unset, [{ op: "unset", path: ["requestsPerMinute"] }]);

  assert.deepEqual(diffOps({ a: 1 }, { a: 1 }), []);
});

test("parseHeaderList: colon and full-width colon, null on a bad token", () => {
  assert.deepEqual(parseHeaderList("x-a: 1; x-b:2"), [
    { name: "x-a", value: "1" },
    { name: "x-b", value: "2" }
  ]);
  assert.deepEqual(parseHeaderList("x-a： 1"), [{ name: "x-a", value: "1" }]);
  assert.deepEqual(parseHeaderList(""), []);
  assert.deepEqual(parseHeaderList(undefined), []);
  assert.equal(parseHeaderList("nope"), null);
  assert.equal(parseHeaderList(": value"), null);
});

/* -------------------------- model detection -------------------------- */

test("mergeDetection: folds the added routes and their advertised models", () => {
  const providers = mergeDetection(
    [
      { id: "nvidia", name: "NVIDIA" },
      { id: "gone", name: "Gone", active: false }
    ],
    { nvidia: [{ id: "deepseek-v4.1-flash", name: "V4.1 Flash", contextWindow: 128000 }, { id: "glm" }] }
  );
  assert.deepEqual(providers.map((p) => p.id), ["nvidia"]);

  const nvidia = providers[0];
  assert.equal(nvidia.name, "NVIDIA");
  assert.deepEqual(nvidia.sources, ["adapter", "listModels"]);
  assert.deepEqual(nvidia.models.map((m) => m.id), ["deepseek-v4.1-flash", "glm"]);
  assert.equal(nvidia.models[0].contextWindow, 128000);
  assert.equal(nvidia.models[1].name, "glm");

  // Only the two added-route surfaces survive: the configurable directory and
  // discovery provenance can never appear, so neither can `settingsNs`.
  assert.equal("settingsNs" in nvidia, false);
  assert.deepEqual(providers.map((p) => p.id).includes("gone"), false);
  assert.deepEqual(mergeDetection(null, null), []);
});

test("mergeDetection: tolerates garbage in every input", () => {
  const providers = mergeDetection([{ id: "", name: "x" }, null], { nvidia: [null, { id: "" }] });
  // Blank ids are dropped; a real provider key survives even when every model in
  // it was unusable (the provider is still worth showing with an empty list).
  assert.deepEqual(providers.map((p) => p.id), ["nvidia"]);
  assert.deepEqual(providers[0].models, []);
  assert.deepEqual(providers[0].sources, ["listModels"]);
  assert.deepEqual(mergeDetection(null, null), []);
  assert.deepEqual(mergeDetection([{ id: 7 }], null), [
    { id: "7", name: "7", sources: ["adapter"], models: [] }
  ]);
});

test("detectedRouteKeys: provider/model pairs", () => {
  assert.deepEqual(detectedRouteKeys([{ id: "nvidia", models: [{ id: "a" }, { id: "b" }] }, { id: "x" }]), [
    "nvidia/a",
    "nvidia/b"
  ]);
  assert.deepEqual(detectedRouteKeys(null), []);
});
