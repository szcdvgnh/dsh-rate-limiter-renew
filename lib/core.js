/**
 * dsh-rate-limiter-renew — framework-free core.
 *
 * Everything in this file is plain ES module JavaScript with **no** import from
 * DeepSeek Harness, so it can be unit-tested with `node --test` on any Node 20+
 * runtime (see test/core.test.mjs). lib/index.js wires it to the Host ctx; the
 * client half re-implements the two tiny parsing helpers it needs because the
 * web bundle boundary does not share module scope.
 */

import { randomBytes } from "node:crypto";

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Standard Crockford base-32 ULID: 10 time chars + 16 random chars = 26. */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Monotonic-ish clock. `performance.now()` when present, wall clock otherwise. */
export function now() {
  const perf = globalThis.performance;
  return perf && typeof perf.now === "function" ? perf.now() : Date.now();
}

/** Standard 26-character ULID (all 80 random bits are used, 5 bits per char). */
export function ulid() {
  let time = Date.now();
  let head = "";
  for (let i = 0; i < 10; i += 1) {
    head = ULID_ALPHABET[time % 32] + head;
    time = Math.floor(time / 32);
  }
  const bytes = randomBytes(10);
  let acc = 0;
  let bits = 0;
  let tail = "";
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      tail += ULID_ALPHABET[(acc >>> bits) & 31];
    }
  }
  if (bits > 0) tail += ULID_ALPHABET[(acc << (5 - bits)) & 31];
  return (head + tail).slice(0, 26);
}

/** Resolve an AbortSignal-aware sleep. Resolves `false` when aborted first. */
export function delay(ms, signal) {
  if (!(ms > 0)) return Promise.resolve(!signal?.aborted);
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve(true);
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve(false);
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/* ------------------------------------------------------------------ *
 * Token bucket
 * ------------------------------------------------------------------ */

/**
 * Reservation-based token bucket, one per (provider, model) route.
 *
 * `next` is the earliest timestamp at which the next request may leave, and the
 * `floor` term (`now - (capacity - 1) * interval`) is what makes an idle bucket
 * recover its burst without ever storing more than `capacity` tokens:
 *
 *     floor = now - (capacity - 1) * interval
 *     base  = max(next, floor, coolUntil)
 *     wait  = max(0, base - now);  next = base + interval
 *
 * `perSecond <= 0` means unlimited (rpm = 0 is the explicit "no limit" sentinel,
 * not a value that silently falls back to a global rule).
 */
export class TokenBucket {
  constructor(capacity, perSecond, at = now()) {
    this.capacity = Math.max(1, Math.floor(Number(capacity) || 1));
    this.perSecond = Number(perSecond) || 0;
    this.unlimited = !(this.perSecond > 0);
    this.intervalMs = this.unlimited ? 0 : 60000 / this.perSecond;
    this.next = at - (this.capacity - 1) * this.intervalMs;
    // -Infinity, not 0: `0` is a real instant on the monotonic clock, so a
    // bucket built shortly after process start would otherwise lose its burst
    // (base = max(next, floor, 0) clamps the early slots up to time 0).
    this.coolUntil = Number.NEGATIVE_INFINITY;
    this.consecutiveFails = 0;
    this.activeCount = 0;
    this.slotWaiters = [];
    this.queuedNow = 0;
    this.reserved = 0;
    this.waited = 0;
    this.totalWaitMs = 0;
    this.rejected = 0;
  }

  /**
   * Re-tune in place. Never clears the pace: clearing would hand out an instant
   * free burst and strand waiters that are already queued for this bucket.
   */
  retune(capacity, perSecond, at = now()) {
    const nextCapacity = Math.max(1, Math.floor(Number(capacity) || 1));
    const nextPerSecond = Number(perSecond) || 0;
    if (nextCapacity === this.capacity && nextPerSecond === this.perSecond) return;
    this.capacity = nextCapacity;
    this.perSecond = nextPerSecond;
    this.unlimited = !(nextPerSecond > 0);
    this.intervalMs = this.unlimited ? 0 : 60000 / nextPerSecond;
    const floor = at - (this.capacity - 1) * this.intervalMs;
    this.next = Math.max(this.next, floor);
  }

  /** Hold the bucket shut until `at + ms` (upstream 429 back-off). */
  cool(ms, at = now()) {
    this.coolUntil = Math.max(this.coolUntil, at + Math.max(0, ms));
  }

  peekWait(at = now()) {
    if (this.unlimited) return 0;
    const floor = at - (this.capacity - 1) * this.intervalMs;
    const base = Math.max(this.next, floor, this.coolUntil);
    return Math.max(0, base - at);
  }

  /** Reserve a slot. Returns the delay the caller must observe before sending. */
  reserve(at = now()) {
    this.reserved += 1;
    if (this.unlimited) return 0;
    const floor = at - (this.capacity - 1) * this.intervalMs;
    const base = Math.max(this.next, floor, this.coolUntil);
    const waitMs = Math.max(0, base - at);
    this.next = base + this.intervalMs;
    if (waitMs > 0) {
      this.waited += 1;
      this.totalWaitMs += waitMs;
    }
    return waitMs;
  }

  markRejected() {
    this.rejected += 1;
  }

  resetStats() {
    this.reserved = 0;
    this.waited = 0;
    this.totalWaitMs = 0;
    this.rejected = 0;
  }

  getStats(at = now()) {
    return {
      capacity: this.capacity,
      perSecond: this.perSecond,
      unlimited: this.unlimited,
      reserved: this.reserved,
      waited: this.waited,
      queuedNow: this.queuedNow,
      totalWaitMs: this.totalWaitMs,
      rejected: this.rejected,
      avgWaitMs: this.waited > 0 ? this.totalWaitMs / this.waited : 0,
      peekWaitMs: this.peekWait(at),
      coolMs: Math.max(0, this.coolUntil - at),
      activeCount: this.activeCount,
      consecutiveFails: this.consecutiveFails
    };
  }
}

/** FIFO concurrency gate. Resolves `false` when the signal aborts while queued. */
export function acquireConcurrencySlot(bucket, max, signal) {
  if (!(max > 0)) return Promise.resolve(true);
  if (signal?.aborted) return Promise.resolve(false);
  if (bucket.activeCount < max) {
    bucket.activeCount += 1;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const waiter = {
      // A release hands its slot straight over, so `activeCount` is unchanged:
      // incrementing here would leak one slot per hand-off.
      grant() {
        signal?.removeEventListener?.("abort", onAbort);
        resolve(true);
      },
      abort() {
        resolve(false);
      }
    };
    function onAbort() {
      const index = bucket.slotWaiters.indexOf(waiter);
      if (index >= 0) bucket.slotWaiters.splice(index, 1);
      bucket.queuedNow = Math.max(0, bucket.queuedNow - 1);
      resolve(false);
    }
    bucket.slotWaiters.push(waiter);
    bucket.queuedNow += 1;
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/** Release one concurrency slot, handing it straight to the oldest waiter. */
export function releaseConcurrencySlot(bucket) {
  const waiter = bucket.slotWaiters.shift();
  if (waiter) {
    bucket.queuedNow = Math.max(0, bucket.queuedNow - 1);
    waiter.grant();
    return;
  }
  bucket.activeCount = Math.max(0, bucket.activeCount - 1);
}

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  /**
   * Which routes the limiter applies to:
   *   "all"       — every route is limited (per-route overrides still win);
   *   "overrides" — only routes that match a `models` row are limited, every
   *                 other call passes straight through.
   * Turning the limiter off entirely is `enabled: false` (the GUI's third
   * choice), which is why there is no "off" member here.
   */
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
  models: [],
  identityRules: []
});

/**
 * Unwrap the live `.volatile()` refs the Config loader hands to `apply()`.
 * A volatile field arrives as `{ get() }` and commits in place, so reading it
 * once at apply time would freeze the value forever.
 */
export function resolveConfig(config) {
  const out = {};
  if (!config || typeof config !== "object") return out;
  for (const key of Object.keys(config)) {
    const value = config[key];
    out[key] =
      value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
  }
  return out;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** rpm keeps 0 as the explicit unlimited sentinel; only negatives fall back. */
function rpm(value, fallback = DEFAULT_CONFIG.requestsPerMinute) {
  const n = Math.floor(num(value, fallback));
  return n < 0 ? fallback : n;
}

export function normalizeConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  const models = Array.isArray(cfg.models)
    ? cfg.models
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          provider: String(entry.provider ?? ""),
          model: String(entry.model ?? ""),
          requestsPerMinute: rpm(entry.requestsPerMinute),
          burst: Math.max(1, Math.floor(num(entry.burst, DEFAULT_CONFIG.burst)))
        }))
    : [];
  const identityRules = Array.isArray(cfg.identityRules)
    ? cfg.identityRules
        .filter((entry) => entry && typeof entry === "object" && String(entry.urlPattern ?? "").length > 0)
        .map((entry) => ({
          urlPattern: String(entry.urlPattern),
          userAgent: String(entry.userAgent ?? ""),
          dynamicIds: entry.dynamicIds === true,
          headers: Array.isArray(entry.headers)
            ? entry.headers
                .filter((header) => header && typeof header === "object" && String(header.name ?? "").length > 0)
                .map((header) => ({ name: String(header.name), value: String(header.value ?? "") }))
            : [],
          enabled: entry.enabled !== false
        }))
    : [];
  return {
    enabled: cfg.enabled !== false,
    scope: cfg.scope === "overrides" ? "overrides" : "all",
    requestsPerMinute: rpm(cfg.requestsPerMinute),
    burst: Math.max(1, Math.floor(num(cfg.burst, DEFAULT_CONFIG.burst))),
    mode: cfg.mode === "reject" ? "reject" : "wait",
    maxWaitMs: Math.max(0, num(cfg.maxWaitMs, DEFAULT_CONFIG.maxWaitMs)),
    upstream429Backoff: cfg.upstream429Backoff !== false,
    backoffMs: Math.max(0, num(cfg.backoffMs, DEFAULT_CONFIG.backoffMs)),
    maxBackoffMs: Math.max(0, num(cfg.maxBackoffMs, DEFAULT_CONFIG.maxBackoffMs)),
    backoffJitter: Math.min(1, Math.max(0, num(cfg.backoffJitter, DEFAULT_CONFIG.backoffJitter))),
    maxConcurrentRequests: Math.max(0, Math.floor(num(cfg.maxConcurrentRequests, DEFAULT_CONFIG.maxConcurrentRequests))),
    autoDetectModels: cfg.autoDetectModels !== false,
    detectIntervalMs: Math.max(0, num(cfg.detectIntervalMs, DEFAULT_CONFIG.detectIntervalMs)),
    models,
    identityRules
  };
}

/**
 * Pick the per-route override row for one (provider, model) call.
 *
 * Exact `provider`+`model` wins outright. Every other row is scored so the most
 * specific pattern wins, which keeps the legacy README semantics ("provider/model
 * 子串比对") useful: an exact provider name beats a substring one (4 vs 2), a
 * matching model pattern beats a provider-wide row (4 vs 0), and both beat the
 * global `{provider:"", model:""}` row so a global default can never shadow a
 * narrower rule.
 */
export function limitFor(models, provider, model) {
  const list = Array.isArray(models) ? models : [];
  const p = String(provider ?? "");
  const m = String(model ?? "");
  for (const row of list) if (row.provider === p && row.model === m) return row;
  let best = null;
  for (const row of list) {
    const rp = String(row.provider ?? "");
    const rm = String(row.model ?? "");
    if (rp && rp !== p && !p.includes(rp)) continue;
    if (rm && rm !== m && !m.includes(rm)) continue;
    const score = (rp === p ? 4 : rp ? 2 : 0) + (rm === m ? 8 : rm ? 4 : 0);
    if (!best || score > best.score) best = { score, row };
  }
  return best ? best.row : null;
}

/**
 * Effective limits for one (provider, model) call, honouring `scope`.
 *
 * Returns `null` when the call must **not** be limited at all: `scope:
 * "overrides"` and no `models` row matched. `null` is the caller's signal to
 * pass the request straight through — no bucket, no queueing, no concurrency
 * gate, no upstream-429 cool-down. `scope: "all"` always returns limits, using
 * the override row when there is one and the default rate otherwise.
 */
export function routeLimits(cfg, provider, model) {
  const config = cfg && typeof cfg === "object" ? cfg : {};
  const override = limitFor(config.models, provider, model);
  if (!override && config.scope === "overrides") return null;
  const perMinute = override ? rpm(override.requestsPerMinute) : rpm(config.requestsPerMinute);
  const burst = override ? override.burst : config.burst;
  return {
    capacity: Math.max(1, Math.floor(num(burst, DEFAULT_CONFIG.burst))),
    perMinute,
    perSecond: perMinute > 0 ? perMinute / 60 : 0
  };
}

/**
 * Upstream-429 back-off. `Retry-After` (providerRetryAfterMs) wins when present
 * and is used verbatim; otherwise `backoffMs` doubles per consecutive failure up
 * to `maxBackoffMs`, then jitter is applied symmetrically.
 */
export function backoffDelayMs(bucket, cfg, providerRetryAfterMs, random = Math.random) {
  const hasProviderRetry = Number.isFinite(providerRetryAfterMs) && providerRetryAfterMs > 0;
  const base = Math.max(0, Number(cfg?.backoffMs) || 0);
  const cap = Number(cfg?.maxBackoffMs) > 0 ? Number(cfg.maxBackoffMs) : Number.POSITIVE_INFINITY;
  let ms;
  if (hasProviderRetry) {
    ms = Number(providerRetryAfterMs);
  } else {
    const factor = Math.pow(2, Math.max(0, bucket?.consecutiveFails ?? 0));
    ms = Math.min((base || 30000) * factor, cap);
  }
  const jitter = Math.min(1, Math.max(0, Number(cfg?.backoffJitter) || 0));
  if (jitter > 0) ms *= 1 + jitter * (random() * 2 - 1);
  return Math.max(1, Math.round(ms));
}

/** Synthetic RATE_LIMIT failure used in `reject` mode. */
export function rateLimitFailure(provider, model, perMinute, waitMs) {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  const scope = perMinute > 0 ? `${perMinute} req/min` : "the configured limit";
  return {
    message: `Rate limit: ${provider}/${model} exceeded ${scope}; retry in ${seconds}s`,
    code: "RATE_LIMIT",
    status: 429,
    providerRetryAfterMs: Math.max(waitMs, 1000)
  };
}

/* ------------------------------------------------------------------ *
 * Settings-path ops
 * ------------------------------------------------------------------ */

/**
 * Validate the `SettingsPathOp[]` shape accepted by `settings.mutate()`.
 * Returns a normalised copy, or `null` when the payload is malformed.
 */
export function validateOps(ops) {
  if (!Array.isArray(ops)) return null;
  const out = [];
  for (const op of ops) {
    if (!op || typeof op !== "object") return null;
    const path = op.path;
    if (!Array.isArray(path) || path.length === 0) return null;
    if (!path.every((segment) => typeof segment === "string" && segment.length > 0)) return null;
    if (op.op === "unset") {
      out.push({ op: "unset", path: [...path] });
      continue;
    }
    if (op.op === "set" && "value" in op) {
      out.push({ op: "set", path: [...path], value: op.value });
      continue;
    }
    return null;
  }
  return out;
}

/**
 * Diff a loaded settings document against an edited draft into whole-field
 * `set` ops. Arrays (models / identityRules) are replaced wholesale, which
 * avoids the index-shifting trap of per-element ops after a removal.
 */
export function diffOps(original, draft) {
  const ops = [];
  const before = original && typeof original === "object" ? original : {};
  const after = draft && typeof draft === "object" ? draft : {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    if (JSON.stringify(after[key]) === JSON.stringify(DEFAULT_CONFIG[key])) {
      ops.push({ op: "unset", path: [key] });
      continue;
    }
    ops.push({ op: "set", path: [key], value: after[key] });
  }
  return ops;
}

/** "Name: Value; Other: Value" → [{name, value}]; returns null on a bad token. */
export function parseHeaderList(text) {
  const out = [];
  const source = String(text ?? "");
  for (const chunk of source.split(";")) {
    const token = chunk.trim();
    if (token.length === 0) continue;
    const index = token.search(/[:：]/);
    if (index <= 0) return null;
    const headerName = token.slice(0, index).trim();
    const headerValue = token.slice(index + 1).trim();
    if (headerName.length === 0) return null;
    out.push({ name: headerName, value: headerValue });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Model detection
 * ------------------------------------------------------------------ */

/**
 * Fold the registered-route surface into one provider→models table.
 *
 * Only the two *added* surfaces are read: `listProviders()` ("provider routes
 * with a registered adapter") and `listModels()` ("models advertised by one
 * registered provider"). The configurable-provider directory and
 * `discoverModels()` are deliberately not consulted — the directory lists routes
 * "registered or dormant", and discovery "describes a draft, not a stored route",
 * so folding either in made the card advertise providers and models the user
 * never added.
 *
 * @param providers - `llm.listProviders()` rows (`{id, name}`, registration order).
 * @param modelsByProvider - `provider id → llm.listModels(id)` rows.
 * @returns one entry per registered route, id-sorted, models id-sorted.
 */
export function mergeDetection(providers, modelsByProvider) {
  const table = new Map();
  const ensure = (id, seed) => {
    const key = String(id ?? "");
    if (!key) return null;
    let entry = table.get(key);
    if (!entry) {
      entry = { id: key, name: seed?.name ? String(seed.name) : key, sources: [], models: new Map() };
      table.set(key, entry);
    }
    if (seed?.name) entry.name = String(seed.name);
    if (seed?.source && !entry.sources.includes(seed.source)) entry.sources.push(seed.source);
    return entry;
  };
  for (const provider of providers ?? []) {
    if (provider?.active === false) continue;
    ensure(provider?.provider ?? provider?.id, {
      name: provider?.name ?? provider?.displayName,
      source: "adapter"
    });
  }
  const addModels = (providerId, models) => {
    const entry = ensure(providerId, { source: "listModels" });
    if (!entry) return;
    for (const model of models ?? []) {
      const id = String(model?.id ?? model?.model ?? "");
      if (!id) continue;
      const existing = entry.models.get(id);
      entry.models.set(id, {
        id,
        name: String(model?.name ?? existing?.name ?? id),
        contextWindow: Number.isFinite(Number(model?.contextWindow)) ? Number(model.contextWindow) : existing?.contextWindow
      });
    }
  };
  for (const [providerId, models] of Object.entries(modelsByProvider ?? {})) addModels(providerId, models);
  return [...table.values()]
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      sources: [...entry.sources],
      models: [...entry.models.values()].sort((a, b) => a.id.localeCompare(b.id))
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Every (provider, model) pair a detection result covers, as "provider/model". */
export function detectedRouteKeys(providers) {
  const keys = [];
  for (const provider of providers ?? []) {
    const id = String(provider?.id ?? "");
    if (!id) continue;
    for (const model of provider?.models ?? []) {
      const modelId = String(model?.id ?? "");
      if (modelId) keys.push(`${id}/${modelId}`);
    }
  }
  return keys;
}
