/**
 * dsh-rate-limiter-renew — host half (DeepSeek Harness 0.2.x).
 *
 * Per (provider, model) token-bucket rate limiting for every LLM call that goes
 * through `llm/stream`, with reservation-based FIFO pacing, wait/reject modes,
 * upstream-429 cool-down, an optional concurrency gate, gateway identity rules
 * (User-Agent rewrite + dynamic OpenCode ids + static headers) and live stats.
 *
 * Modernised from dsh-provider-rate-limit 0.3.1 for DSH 0.2.0+:
 *   - plugin Config is declared on `Config` with `.volatile()` per editable field
 *     (the old `installSettingsSection` / `provider.installSection` /
 *     `register(ns, schema, …)` namespace API is gone);
 *   - the settings namespace is the profile composition entry id (`NS`);
 *   - `ctx.reflect.provide()` → `ctx.provide()`;
 *   - `harness.handle()` → the HTTP bridge under `BRIDGE_PREFIX`;
 *   - the old `scripts/patch-host-allowlist.mjs` host patch is unnecessary: the
 *     bridge calls `settings.mutate()` in-process and never goes through the
 *     web-settings namespace allowlist;
 *   - model/provider discovery is a first-class feature (`/models`).
 */

import { SettingsConflictError } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import {
  acquireConcurrencySlot,
  backoffDelayMs,
  delay,
  limitFor,
  mergeDetection,
  normalizeConfig,
  releaseConcurrencySlot,
  rateLimitFailure,
  resolveConfig,
  TokenBucket,
  ulid,
  validateOps,
  DEFAULT_CONFIG
} from "./core.js";

/** Package name (must match package.json). */
const name = "dsh-rate-limiter-renew";

/** The plugin needs the LLM adapter registry to observe `llm/stream`. */
const inject = ["llm"];

/**
 * Settings namespace == profile composition entry id == the row id declared in
 * cordis.patch.yml. Keep all three in sync.
 */
const NS = "rate-limiter-renew";

/** Cross-plugin service: `ctx.get("rate-limiter-renew/stats")`. */
const SERVICE_NAME = "rate-limiter-renew/stats";

/** Every HTTP endpoint hangs off this prefix. */
const BRIDGE_PREFIX = "/api/dsh-rate-limiter-renew";
const STATS_PATH = `${BRIDGE_PREFIX}/stats`;
const EVENTS_PATH = `${BRIDGE_PREFIX}/events`;
const MODELS_PATH = `${BRIDGE_PREFIX}/models`;
const STATS_RESET_PATH = `${BRIDGE_PREFIX}/stats-reset`;
const DESCRIBE_PATH = `${BRIDGE_PREFIX}/describe`;
const REPLACE_PATH = `${BRIDGE_PREFIX}/replace`;
const MUTATE_PATH = `${BRIDGE_PREFIX}/mutate`;
const RESET_PATH = `${BRIDGE_PREFIX}/reset`;

const MAX_JSON_BODY_BYTES = 64 * 1024;
const SSE_HEARTBEAT_MS = 15000;
const BROADCAST_COALESCE_MS = 15;
const MIN_DETECT_TTL_MS = 5000;

const IDENTITY_PATCH_KEY = Symbol.for("dsh-plugin.rate-limiter-renew.identityFetch");
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */

/**
 * `.volatile()` is mandatory for every editable field on 0.2.x: the loader
 * hands the live ref to `apply()` and commits edits in place, so a plain
 * default would freeze the first read. Needs @deepseek-ai/schemastery >= 3.18.2.
 */
function assertSchemasterySupportsVolatile(schemaLib) {
  let ok = false;
  try {
    ok = typeof schemaLib.string().default("x").volatile === "function";
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new Error(
      `[${name}] the resolved @deepseek-ai/schemastery has no \`.volatile()\` (needs >= 3.18.2; this plugin declares ^3.18.4). ` +
        "A stale nested copy under node_modules/" +
        name +
        "/node_modules/@deepseek-ai/schemastery usually shadows the top-level install. Delete that folder (or reinstall), then fully restart DSH."
    );
  }
}

const ModelLimitConfig = z.object({
  provider: z.string().default(""),
  model: z.string().default(""),
  requestsPerMinute: z.number().default(DEFAULT_CONFIG.requestsPerMinute),
  burst: z.number().default(DEFAULT_CONFIG.burst)
});

const IdentityHeaderConfig = z.object({
  name: z.string().default(""),
  value: z.string().default("")
});

const IdentityRuleConfig = z.object({
  urlPattern: z.string().default(""),
  userAgent: z.string().default(""),
  dynamicIds: z.boolean().default(false),
  headers: z.array(IdentityHeaderConfig).default([]),
  enabled: z.boolean().default(true)
});

const Config = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.enabled).volatile(),
  requestsPerMinute: z.number().default(DEFAULT_CONFIG.requestsPerMinute).volatile(),
  burst: z.number().default(DEFAULT_CONFIG.burst).volatile(),
  mode: z.string().default(DEFAULT_CONFIG.mode).volatile(),
  maxWaitMs: z.number().default(DEFAULT_CONFIG.maxWaitMs).volatile(),
  upstream429Backoff: z.boolean().default(DEFAULT_CONFIG.upstream429Backoff).volatile(),
  backoffMs: z.number().default(DEFAULT_CONFIG.backoffMs).volatile(),
  maxBackoffMs: z.number().default(DEFAULT_CONFIG.maxBackoffMs).volatile(),
  backoffJitter: z.number().default(DEFAULT_CONFIG.backoffJitter).volatile(),
  maxConcurrentRequests: z.number().default(DEFAULT_CONFIG.maxConcurrentRequests).volatile(),
  autoDetectModels: z.boolean().default(DEFAULT_CONFIG.autoDetectModels).volatile(),
  detectIntervalMs: z.number().default(DEFAULT_CONFIG.detectIntervalMs).volatile(),
  models: z.array(ModelLimitConfig).default([]).volatile(),
  identityRules: z.array(IdentityRuleConfig).default([]).volatile()
});

/* ------------------------------------------------------------------ *
 * HTTP helpers
 * ------------------------------------------------------------------ */

function writeJson(res, status, body) {
  if (res.writableEnded) return;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer"
  });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_JSON_BODY_BYTES) return undefined;
      chunks.push(chunk);
    }
  } catch {
    return undefined;
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Loopback-only + same-origin guard (blocks DNS-rebinding and cross-site use of
 * the local bridge). Mirrors the shipped free-search bridge contract.
 */
function isLoopbackRequest(request) {
  const remote = String(request?.socket?.remoteAddress ?? "");
  if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") return false;
  const host = String(request?.headers?.host ?? "");
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!LOOPBACK_HOSTNAMES.has(hostUrl.hostname)) return false;
  if (String(request?.headers?.["sec-fetch-site"] ?? "") === "cross-site") return false;
  const origin = request?.headers?.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== hostUrl.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function isConflictError(error) {
  if (!error) return false;
  if (typeof SettingsConflictError === "function" && error instanceof SettingsConflictError) return true;
  return /revision|conflict/i.test(String(error?.message ?? ""));
}

/* ------------------------------------------------------------------ *
 * Gateway identity patch
 * ------------------------------------------------------------------ */

/**
 * Wrap `globalThis.fetch` so outbound provider calls can be re-labelled.
 * Ref-counted: the native function is restored exactly when the last plugin
 * instance disposes, and only if nobody else replaced the wrapper meanwhile.
 */
function installIdentityPatch(readRules) {
  if (typeof globalThis.fetch !== "function") return () => {};
  const existing = globalThis[IDENTITY_PATCH_KEY];
  if (existing) {
    existing.refs += 1;
    existing.readRules = readRules;
    return () => releaseIdentityPatch(existing);
  }
  const state = { refs: 1, readRules, native: globalThis.fetch, wrap: null, sessionId: `ses_${ulid()}` };
  state.wrap = async function rateLimiterFetch(input, init) {
    let rules = [];
    try {
      rules = state.readRules?.() ?? [];
    } catch {
      rules = [];
    }
    const active = rules.filter((rule) => rule.enabled !== false && rule.urlPattern);
    if (active.length === 0) return state.native.call(globalThis, input, init);
    let url = "";
    if (typeof input === "string") url = input;
    else if (input && typeof input === "object" && typeof input.url === "string") url = input.url;
    else url = String(input ?? "");
    const rule = active.find((candidate) => url.includes(candidate.urlPattern));
    if (!rule) return state.native.call(globalThis, input, init);

    const baseHeaders =
      init?.headers ?? (input && typeof input === "object" && "headers" in input ? input.headers : undefined);
    const headers = new Headers(baseHeaders);
    if (rule.userAgent) headers.set("user-agent", rule.userAgent);
    if (rule.dynamicIds) {
      headers.set("x-opencode-client", "cli");
      headers.set("x-opencode-project", "global");
      // Session id is stable for this plugin instance; each request gets a fresh
      // message id (the old plugin regenerated the session id on every call).
      headers.set("x-opencode-session", state.sessionId);
      headers.set("x-opencode-request", `msg_${ulid()}`);
    }
    for (const header of rule.headers ?? []) {
      if (header?.name) headers.set(header.name, String(header.value ?? ""));
    }

    if (input && typeof input === "object" && typeof input.url === "string") {
      const nextInit = { ...(init ?? {}), headers };
      return state.native.call(globalThis, new Request(input, nextInit));
    }
    return state.native.call(globalThis, input, { ...(init ?? {}), headers });
  };
  globalThis.fetch = state.wrap;
  globalThis[IDENTITY_PATCH_KEY] = state;
  return () => releaseIdentityPatch(state);
}

function releaseIdentityPatch(state) {
  state.refs -= 1;
  if (state.refs > 0) return;
  if (globalThis[IDENTITY_PATCH_KEY] === state) delete globalThis[IDENTITY_PATCH_KEY];
  if (globalThis.fetch === state.wrap) globalThis.fetch = state.native;
}

/* ------------------------------------------------------------------ *
 * Plugin
 * ------------------------------------------------------------------ */

function apply(ctx, config) {
  assertSchemasterySupportsVolatile(z);

  const logger = ctx.logger;
  const current = () => normalizeConfig(resolveConfig(config));

  /** routeKey → TokenBucket */
  const buckets = new Map();
  const sseClients = new Set();
  let broadcastTimer = null;
  let heartbeatTimer = null;
  let detectionTimer = null;

  let detection = { providers: [], errors: [], detectedAt: 0 };
  let detectionInflight = null;

  const routeKey = (provider, model) => `${provider}\u0000${model}`;

  function limitsFor(provider, model) {
    const cfg = current();
    const override = limitFor(cfg.models, provider, model);
    const perMinute = override ? override.requestsPerMinute : cfg.requestsPerMinute;
    return {
      capacity: override ? override.burst : cfg.burst,
      perMinute,
      perSecond: perMinute > 0 ? perMinute / 60 : 0
    };
  }

  function resolveBucket(provider, model) {
    const key = routeKey(provider, model);
    const limits = limitsFor(provider, model);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(limits.capacity, limits.perSecond);
      buckets.set(key, bucket);
    } else {
      bucket.retune(limits.capacity, limits.perSecond);
    }
    return bucket;
  }

  /* ---------------- stats ---------------- */

  function routeStats() {
    const routes = [];
    for (const [key, bucket] of buckets) {
      const index = key.indexOf("\u0000");
      const provider = key.slice(0, index);
      const model = key.slice(index + 1);
      const limits = limitsFor(provider, model);
      routes.push({
        provider,
        model,
        requestsPerMinute: limits.perMinute,
        burst: limits.capacity,
        ...bucket.getStats()
      });
    }
    routes.sort((a, b) => `${a.provider}\u0000${a.model}`.localeCompare(`${b.provider}\u0000${b.model}`));
    return routes;
  }

  function aggregateOf(routes) {
    const total = {
      routes: routes.length,
      reserved: 0,
      waited: 0,
      totalWaitMs: 0,
      rejected: 0,
      queuedNow: 0,
      activeCount: 0,
      avgWaitMs: 0,
      unlimitedRoutes: 0,
      coolingRoutes: 0
    };
    for (const route of routes) {
      total.reserved += route.reserved;
      total.waited += route.waited;
      total.totalWaitMs += route.totalWaitMs;
      total.rejected += route.rejected;
      total.queuedNow += route.queuedNow;
      total.activeCount += route.activeCount;
      if (route.unlimited) total.unlimitedRoutes += 1;
      if (route.coolMs > 0) total.coolingRoutes += 1;
    }
    total.avgWaitMs = total.waited > 0 ? total.totalWaitMs / total.waited : 0;
    return total;
  }

  function snapshot() {
    const cfg = current();
    const routes = routeStats();
    let modelCount = 0;
    for (const provider of detection.providers) modelCount += provider.models.length;
    return {
      ok: true,
      value: {
        at: Date.now(),
        aggregate: aggregateOf(routes),
        routes,
        config: {
          enabled: cfg.enabled,
          mode: cfg.mode,
          requestsPerMinute: cfg.requestsPerMinute,
          burst: cfg.burst,
          maxWaitMs: cfg.maxWaitMs,
          maxConcurrentRequests: cfg.maxConcurrentRequests,
          upstream429Backoff: cfg.upstream429Backoff,
          backoffMs: cfg.backoffMs,
          maxBackoffMs: cfg.maxBackoffMs,
          autoDetectModels: cfg.autoDetectModels,
          detectIntervalMs: cfg.detectIntervalMs,
          ruleCount: cfg.models.length,
          identityRuleCount: cfg.identityRules.length
        },
        detected: {
          providers: detection.providers.length,
          models: modelCount,
          errors: detection.errors.length,
          detectedAt: detection.detectedAt,
          list: detection.providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            sources: provider.sources,
            models: provider.models.map((model) => model.id)
          }))
        }
      }
    };
  }

  function scheduleBroadcast() {
    if (sseClients.size === 0 || broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      writeSseFrame("stats", snapshot());
    }, BROADCAST_COALESCE_MS);
    broadcastTimer.unref?.();
  }

  function writeSseFrame(event, payload) {
    if (sseClients.size === 0) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of [...sseClients]) {
      try {
        client.res.write(frame);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  /* ---------------- model discovery ---------------- */

  async function detectModels({ force = false } = {}) {
    const cfg = current();
    if (!cfg.autoDetectModels && !force) return detection;
    const age = Date.now() - detection.detectedAt;
    const ttl = cfg.detectIntervalMs > 0 ? Math.max(MIN_DETECT_TTL_MS, cfg.detectIntervalMs) : 0;
    if (!force && detection.detectedAt > 0 && ttl > 0 && age < ttl) return detection;
    if (detectionInflight) return detectionInflight;

    const llm = ctx.get("llm") ?? ctx.llm;
    if (!llm || typeof llm.listProviders !== "function") {
      detection = {
        providers: [],
        errors: [{ where: "llm", message: "the llm service is not available in this profile" }],
        detectedAt: Date.now()
      };
      scheduleBroadcast();
      return detection;
    }

    detectionInflight = (async () => {
      const errors = [];
      const fail = (where, error) => errors.push({ where, message: String(error?.message ?? error) });
      let adapters = [];
      let directory = [];
      try {
        adapters = (await llm.listProviders()) ?? [];
      } catch (error) {
        fail("listProviders", error);
      }
      if (typeof llm.listConfigurableProviders === "function") {
        try {
          directory = (await llm.listConfigurableProviders()) ?? [];
        } catch (error) {
          fail("listConfigurableProviders", error);
        }
      }
      const providerIds = new Set();
      for (const entry of adapters) {
        const id = String(entry?.provider ?? entry?.id ?? "");
        if (id) providerIds.add(id);
      }
      for (const entry of directory) {
        const id = String(entry?.provider ?? entry?.id ?? "");
        if (id) providerIds.add(id);
      }
      const modelsByProvider = {};
      for (const id of providerIds) {
        if (typeof llm.listModels !== "function") break;
        try {
          const models = await llm.listModels(id);
          if (Array.isArray(models) && models.length > 0) modelsByProvider[id] = models;
        } catch (error) {
          fail(`listModels:${id}`, error);
        }
      }
      const discoveredByProvider = {};
      for (const entry of directory) {
        const id = String(entry?.provider ?? entry?.id ?? "");
        const ns = entry?.settingsNs ? String(entry.settingsNs) : "";
        if (!id || !ns || modelsByProvider[id]?.length || typeof llm.discoverModels !== "function") continue;
        try {
          const models = await llm.discoverModels(ns, { provider: id });
          if (Array.isArray(models) && models.length > 0) discoveredByProvider[id] = models;
        } catch (error) {
          fail(`discoverModels:${id}`, error);
        }
      }
      detection = {
        providers: mergeDetection(adapters, directory, modelsByProvider, discoveredByProvider),
        errors,
        detectedAt: Date.now()
      };
      scheduleBroadcast();
      return detection;
    })();

    try {
      return await detectionInflight;
    } finally {
      detectionInflight = null;
    }
  }

  function invalidateDetection() {
    detection = { ...detection, detectedAt: 0 };
    void detectModels({ force: true });
  }

  /* ---------------- rate limiting ---------------- */

  async function* runWithBackoff(bucket, next) {
    for await (const chunk of next()) {
      if (chunk?.type === "finish") {
        const reason = chunk.reason ?? {};
        const failure = reason.failure ?? {};
        const cfg = current();
        if (reason.kind === "error" && cfg.upstream429Backoff && Number(failure.status) === 429) {
          const ms = backoffDelayMs(bucket, cfg, Number(failure.providerRetryAfterMs));
          bucket.cool(ms);
          bucket.consecutiveFails += 1;
          logger?.warn?.(
            `[${name}] upstream 429; cooling route for ${ms}ms (consecutive failures: ${bucket.consecutiveFails})`
          );
        } else {
          bucket.consecutiveFails = 0;
        }
      }
      yield chunk;
    }
  }

  async function* handleStream(options, next) {
    const cfg = current();
    if (!cfg.enabled) {
      yield* next();
      return;
    }
    const provider = String(options?.provider ?? "");
    const model = String(options?.model ?? "");
    const bucket = resolveBucket(provider, model);
    const limits = limitsFor(provider, model);

    const waitMs = bucket.reserve();
    if (waitMs > 0) {
      if (cfg.mode === "reject" || waitMs > cfg.maxWaitMs) {
        bucket.markRejected();
        scheduleBroadcast();
        logger?.warn?.(
          `[${name}] rejected ${provider}/${model}: ${cfg.mode === "reject" ? "reject mode" : `wait ${Math.round(waitMs)}ms > maxWaitMs ${cfg.maxWaitMs}ms`}`
        );
        yield {
          type: "finish",
          reason: { kind: "error", failure: rateLimitFailure(provider, model, limits.perMinute, waitMs) }
        };
        return;
      }
      const waited = await delay(waitMs, options?.signal);
      if (!waited) {
        yield {
          type: "finish",
          reason: {
            kind: "aborted",
            failure: { message: `${name}: aborted while waiting ${Math.round(waitMs)}ms for a rate-limit slot`, code: "RATE_LIMIT_ABORTED" }
          }
        };
        return;
      }
    }

    const acquired = await acquireConcurrencySlot(bucket, cfg.maxConcurrentRequests, options?.signal);
    if (!acquired) {
      yield {
        type: "finish",
        reason: {
          kind: "aborted",
          failure: { message: `${name}: aborted while queued for a concurrency slot`, code: "RATE_LIMIT_ABORTED" }
        }
      };
      return;
    }

    try {
      yield* runWithBackoff(bucket, next);
    } finally {
      releaseConcurrencySlot(bucket);
      scheduleBroadcast();
    }
  }

  ctx.on("llm/stream", handleStream, { global: true, prepend: true });

  // Provider topology changed (adapter registered/disposed, configurable-provider
  // directory edited): the cached model table is stale by definition.
  ctx.on("llm/adapters-updated", () => {
    invalidateDetection();
  });

  /* ---------------- cross-plugin service ---------------- */

  const statsService = {
    getName: () => name,
    getNamespace: () => NS,
    getStats(provider, model) {
      const key = routeKey(String(provider ?? ""), String(model ?? ""));
      const bucket = buckets.get(key);
      if (!bucket) return null;
      const limits = limitsFor(String(provider ?? ""), String(model ?? ""));
      return { provider, model, requestsPerMinute: limits.perMinute, burst: limits.capacity, ...bucket.getStats() };
    },
    getAllStats() {
      return routeStats();
    },
    getAggregateStats() {
      return aggregateOf(routeStats());
    },
    resetStats(provider, model) {
      if (provider === undefined && model === undefined) {
        for (const bucket of buckets.values()) bucket.resetStats();
        scheduleBroadcast();
        return true;
      }
      const bucket = buckets.get(routeKey(String(provider ?? ""), String(model ?? "")));
      if (!bucket) return false;
      bucket.resetStats();
      scheduleBroadcast();
      return true;
    },
    async detectModels(options) {
      const result = await detectModels({ force: options?.force === true });
      return result.providers;
    },
    getDetectedModels() {
      return detection.providers;
    }
  };

  if (typeof ctx.provide === "function") {
    try {
      ctx.effect(() => ctx.provide(SERVICE_NAME, statsService), `${name}: stats service`);
    } catch (error) {
      logger?.warn?.(`[${name}] could not provide ${SERVICE_NAME}: ${String(error?.message ?? error)}`);
    }
  } else {
    logger?.warn?.(`[${name}] ctx.provide is unavailable; the ${SERVICE_NAME} service is not exported`);
  }

  /* ---------------- identity rules ---------------- */

  const disposeIdentity = installIdentityPatch(() => current().identityRules);
  ctx.effect(() => disposeIdentity, `${name}: gateway identity fetch patch`);

  /* ---------------- HTTP bridge ---------------- */

  function describeNamespace() {
    const settings = ctx.get("settings");
    if (!settings || typeof settings.describe !== "function") {
      return { ok: false, code: "settings-absent", message: "the settings service is unavailable in this profile" };
    }
    const descriptors = settings.describe({ redactSecrets: true }) ?? [];
    const descriptor = descriptors.find((entry) => String(entry?.ns) === NS);
    if (!descriptor) {
      return {
        ok: false,
        code: "settings-not-exposed",
        message: `settings namespace "${NS}" is not registered in this profile (expected the composition entry id "${NS}")`
      };
    }
    return {
      ok: true,
      value: {
        ns: String(descriptor.ns),
        value: descriptor.value ?? {},
        revision: descriptor.revision,
        autoGenerate: descriptor.autoGenerate === true,
        writable: settings.writable !== false,
        applies: descriptor.applies ?? "live"
      }
    };
  }

  function settingsOf() {
    const settings = ctx.get("settings");
    if (!settings || typeof settings.mutate !== "function") return null;
    return settings;
  }

  function bridgeRoutes() {
    const post = (path, handler) => ({
      kind: "exact",
      path,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { ok: false, code: "untrusted-request", message: "loopback requests only" });
          return;
        }
        if (req.method !== "POST") {
          writeJson(res, 405, { ok: false, code: "method-not-allowed", message: `method not allowed: ${req.method ?? ""}` });
          return;
        }
        const body = await readJsonBody(req);
        if (body === undefined) {
          writeJson(res, 400, { ok: false, code: "settings-rejected", message: "malformed JSON body" });
          return;
        }
        try {
          writeJson(res, 200, await handler(body));
        } catch (error) {
          if (isConflictError(error)) {
            writeJson(res, 200, { ok: false, code: "settings-conflict", message: String(error?.message ?? error) });
            return;
          }
          writeJson(res, 200, { ok: false, code: "settings-rejected", message: String(error?.message ?? error) });
        }
      }
    });

    return [
      post(DESCRIBE_PATH, async () => describeNamespace()),

      post(REPLACE_PATH, async (body) => {
        const settings = settingsOf();
        if (!settings) return { ok: false, code: "settings-absent", message: "the settings service is unavailable" };
        if (!body?.section || typeof body.section !== "object") {
          return { ok: false, code: "settings-rejected", message: "body.section must be an object" };
        }
        await settings.replace(NS, body.section, body.expectedRevision);
        return describeNamespace();
      }),

      post(MUTATE_PATH, async (body) => {
        const settings = settingsOf();
        if (!settings) return { ok: false, code: "settings-absent", message: "the settings service is unavailable" };
        const ops = validateOps(body?.ops);
        if (!ops) return { ok: false, code: "settings-rejected", message: "body.ops must be a SettingsPathOp[]" };
        await settings.mutate(NS, ops, body.expectedRevision);
        return describeNamespace();
      }),

      post(RESET_PATH, async (body) => {
        const settings = settingsOf();
        if (!settings) return { ok: false, code: "settings-absent", message: "the settings service is unavailable" };
        await settings.replace(NS, {}, body?.expectedRevision);
        return describeNamespace();
      }),

      post(MODELS_PATH, async (body) => {
        const result = await detectModels({ force: body?.force === true });
        return { ok: true, value: { providers: result.providers, errors: result.errors, detectedAt: result.detectedAt } };
      }),

      post(STATS_PATH, async () => snapshot()),

      post(STATS_RESET_PATH, async (body) => {
        const all = body?.provider === undefined && body?.model === undefined;
        const changed = statsService.resetStats(body?.provider, body?.model);
        return { ok: true, value: { reset: all ? "all" : `${body?.provider ?? ""}/${body?.model ?? ""}`, changed } };
      }),

      {
        kind: "exact",
        path: EVENTS_PATH,
        handler: (req, res) => {
          if (req.method !== "GET") {
            writeJson(res, 405, { ok: false, code: "method-not-allowed", message: `method not allowed: ${req.method ?? ""}` });
            return;
          }
          if (!isLoopbackRequest(req)) {
            writeJson(res, 403, { ok: false, code: "untrusted-request", message: "loopback requests only" });
            return;
          }
          res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
            "referrer-policy": "no-referrer"
          });
          const client = { res };
          sseClients.add(client);
          const cleanup = () => {
            sseClients.delete(client);
          };
          req.on("close", cleanup);
          req.on("error", cleanup);
          res.on("error", cleanup);
          try {
            res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
          } catch {
            cleanup();
          }
          if (detection.detectedAt === 0) void detectModels({ force: true });
        }
      }
    ];
  }

  // This plugin ships its own configuration page (the client half mounts it into
  // `plugins.row.config`), so record `auto: false` and keep the Host from also
  // generating a schema form for the same entry.
  ctx.inject(["settings"], (sctx) => {
    sctx.effect(
      () => sctx.settings.configure({ auto: false }, ctx.fiber),
      `${name}: settings page policy`
    );
    sctx.on("settings/document-updated", (ns) => {
      if (String(ns ?? "") !== NS) return;
      scheduleBroadcast();
    });
  });

  ctx.inject(["webServer"], (sctx) => {
    const webServer = sctx.get("webServer") ?? sctx.webServer;
    if (!webServer || typeof webServer.register !== "function") {
      logger?.warn?.(`[${name}] the webServer service is unavailable; the settings bridge and live stats are disabled`);
      return;
    }
    sctx.effect(() => {
      const disposers = [];
      for (const route of bridgeRoutes()) {
        try {
          disposers.push(webServer.register(route));
        } catch (error) {
          logger?.warn?.(`[${name}] could not register ${route.path}: ${String(error?.message ?? error)}`);
        }
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {
            /* already disposed */
          }
        }
      };
    }, `${name}: http bridge`);
  });

  /* ---------------- timers ---------------- */

  ctx.effect(() => {
    heartbeatTimer = setInterval(() => {
      if (sseClients.size === 0) return;
      for (const client of [...sseClients]) {
        try {
          client.res.write(": ping\n\n");
        } catch {
          sseClients.delete(client);
        }
      }
    }, SSE_HEARTBEAT_MS);
    heartbeatTimer.unref?.();
    return () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (broadcastTimer) clearTimeout(broadcastTimer);
      broadcastTimer = null;
      for (const client of [...sseClients]) {
        try {
          client.res.end();
        } catch {
          /* already closed */
        }
      }
      sseClients.clear();
    };
  }, `${name}: sse heartbeat`);

  ctx.effect(() => {
    const cfg = current();
    if (!cfg.autoDetectModels || !(cfg.detectIntervalMs > 0)) return () => {};
    // Warm the model table at startup and refresh it on the configured cadence.
    void detectModels({ force: true });
    detectionTimer = setInterval(() => {
      void detectModels({ force: true });
    }, Math.max(MIN_DETECT_TTL_MS, cfg.detectIntervalMs));
    detectionTimer.unref?.();
    return () => {
      if (detectionTimer) clearInterval(detectionTimer);
      detectionTimer = null;
    };
  }, `${name}: model discovery`);

  logger?.info?.(`[${name}] rate limiter active (namespace "${NS}", bridge ${BRIDGE_PREFIX})`);
}

export { Config, DEFAULT_CONFIG, name, inject, apply, NS, SERVICE_NAME, BRIDGE_PREFIX };
