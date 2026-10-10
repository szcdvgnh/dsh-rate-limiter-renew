/**
 * dsh-rate-limiter-renew — client half (static web bundle for DSH 0.2.x).
 *
 * Loaded by `window.__ModuleLoader__.load`, so this file is delivered verbatim to
 * the browser: no JSX transform, no bundler, no dynamic `host.call`. Everything
 * it needs from the Host goes through the plugin's own HTTP bridge under
 * `/api/dsh-rate-limiter-renew` — including provider/model discovery, which the
 * old plugin tried (and failed) to read from a `connection.api.llm` client
 * service that no longer exists.
 *
 * Modernised from dsh-provider-rate-limit 0.3.1:
 *   - `settings.plugin.item` (removed in rc.1) → `plugins.row.config`, keyed
 *     `<package name>#<patch row id>` = `dsh-rate-limiter-renew#rate-limiter-renew`;
 *   - `dsh-client-store`'s `createSnapshotStore` → a local observable store;
 *   - `settings.writable` now comes from the bridge, not from the descriptor;
 *   - the settings document is read/written through `/describe` + `/replace`.
 */

window.__ModuleLoader__.load({
  id: "dsh-rate-limiter-renew",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const react = require("react");
    const h = react.createElement;

    /* ------------------------------------------------------------------ *
     * Constants
     * ------------------------------------------------------------------ */

    /** Settings namespace == profile composition entry id. */
    const NS = "rate-limiter-renew";
    const BRIDGE_PREFIX = "/api/dsh-rate-limiter-renew";
    /** `plugins.row.config` key: `<package name>#<patch row id>`. */
    const ROW_KEY = "dsh-rate-limiter-renew#rate-limiter-renew";
    const inject = ["slots"];

    const DEFAULTS = {
      enabled: true,
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
      detectIntervalMs: 60000
    };

    const OPENCODE_PRESET = {
      urlPattern: "opencode.ai/zen",
      userAgent: "opencode/1.18.25 ai-sdk/provider-utils/4.0.38 runtime/bun/1.3.14",
      dynamicIds: true,
      enabled: true
    };

    /* ------------------------------------------------------------------ *
     * i18n
     * ------------------------------------------------------------------ */

    const DICT = {
      zh: {
        title: "路由限速（Renew）",
        desc: "按供應商與模型粒度限速 LLM 請求：預約式令牌桶、FIFO 排隊、429 退避與身份改寫。",
        enabled: "啟用限速",
        enabledHint: "總開關；每個請求都會即時檢查，關閉後直接放行。",
        defaultRpm: "預設 RPM",
        defaultRpmHint: "每個 (供應商, 模型) 的每分鐘上限；0 = 不限速。",
        defaultBurst: "突發額度",
        defaultBurstHint: "空閒後可立即發出的最大請求數。",
        mode: "空桶行為",
        modeWait: "等待（排隊）",
        modeReject: "拒絕（回傳 429）",
        maxWaitMs: "最大等待（毫秒）",
        maxWaitMsHint: "等待模式下的排隊上限；超過就改為拒絕。",
        upstream429Backoff: "上游 429 退避",
        upstream429BackoffHint: "收到 429 時冷卻該路由，連續失敗指數加倍。",
        backoffMs: "退避基準（毫秒）",
        backoffMsHint: "沒有 Retry-After 時使用的初始冷卻時間。",
        maxBackoffMs: "退避上限（毫秒）",
        maxBackoffMsHint: "指數退避的天花板。",
        backoffJitter: "退避抖動（0-1）",
        backoffJitterHint: "對退避時間加入對稱隨機抖動。",
        maxConcurrentRequests: "最大併發",
        maxConcurrentRequestsHint: "0 = 不限制；大於 0 時以 FIFO 分配併發槽位。",
        detectTitle: "模型自動偵測",
        autoDetectModels: "自動偵測我的模型",
        autoDetectModelsHint: "從 Host 的 LLM 服務讀取供應商與模型清單（含 llm-pi-ai 等自訂 provider）。",
        detectIntervalMs: "偵測間隔（毫秒）",
        detectIntervalMsHint: "0 = 只在開啟頁面或 provider 拓撲變動時偵測。",
        detectedProviders: "偵測到的供應商",
        detectedModels: "偵測到的模型",
        addDetectedProviders: "加入所有供應商（整條路由）",
        addDetectedModels: "加入所有模型（逐模型）",
        refreshDetect: "重新偵測",
        detectedAt: "偵測時間",
        detectErrors: "偵測警告",
        rowsTitle: "每路由覆寫",
        rowsHint: "provider / model 留空代表「全部」；先精確比對，再退回子串比對。",
        provider: "供應商",
        model: "模型",
        rpm: "RPM",
        burst: "突發",
        allProviders: "（全部）",
        allModels: "（全部）",
        remove: "移除",
        addRow: "新增路由",
        identityTitle: "閘道身份規則",
        identityDesc: "改寫送往上游的 User-Agent、注入動態 OpenCode ID 與自訂標頭。",
        identityUrlPattern: "URL 比對字串",
        identityUa: "User-Agent",
        identityUaPlaceholder: "留空 = 不改寫",
        identityDynamic: "注入動態 x-opencode-* ID",
        identityHeaders: "自訂標頭（Name: Value; 以分號分隔）",
        identityHeadersPlaceholder: "x-foo: bar; x-baz: qux",
        identityEnabled: "啟用",
        identityAdd: "新增規則",
        presetZen: "套用 OpenCode Zen 預設",
        identityInvalid: "身份規則有誤：",
        invalidNumbers: "數值欄位有誤：",
        statsTitle: "即時統計",
        statsRoutes: "路由數",
        statsRejected: "已拒絕",
        statsWaited: "曾等待",
        statsAvgWait: "平均等待",
        statsTotal: "總請求",
        statsQueued: "排隊中",
        statsCooling: "冷卻中",
        statsLoading: "統計載入中…",
        statsReset: "重設統計",
        statsResetDone: "統計已重設",
        save: "儲存",
        discard: "放棄變更",
        resetAll: "回復預設",
        resetConfirm: "確定要放棄所有自訂設定並回復預設值嗎？",
        saved: "已儲存",
        dirty: "尚未儲存",
        failed: "儲存失敗",
        conflictStale: "設定已被其他視窗修改，已重新載入。",
        notWritable: "目前設定不可寫入。",
        settingsMissing: "Host 尚未註冊此 plugin 的設定命名空間，請確認 cordis.patch.yml 中的 id 為 rate-limiter-renew。",
        loading: "載入中…",
        unavailable: "無法連線到 Host 橋接端點。",
        stateOn: "開",
        stateOff: "關",
        dockRejected: "拒絕",
        dockWaited: "等待",
        dockQueued: "排隊",
        dockActive: "進行中",
        dockRoutes: "路由",
        dockOff: "限速已關閉",
        dockNoData: "限速待命"
      },
      en: {
        title: "Route rate limiter (Renew)",
        desc: "Rate-limits LLM requests per provider and model: reservation token buckets, FIFO queueing, 429 back-off and identity rewriting.",
        enabled: "Enable rate limiting",
        enabledHint: "Master switch, checked on every request; when off requests pass straight through.",
        defaultRpm: "Default RPM",
        defaultRpmHint: "Per-minute ceiling for each (provider, model); 0 = unlimited.",
        defaultBurst: "Burst capacity",
        defaultBurstHint: "Most requests that may leave immediately after an idle period.",
        mode: "When the bucket is empty",
        modeWait: "Wait (queue)",
        modeReject: "Reject (429)",
        maxWaitMs: "Max wait (ms)",
        maxWaitMsHint: "Queue ceiling in wait mode; beyond it the call is rejected.",
        upstream429Backoff: "Back off on upstream 429",
        upstream429BackoffHint: "Cool the route on 429; consecutive failures double the delay.",
        backoffMs: "Back-off base (ms)",
        backoffMsHint: "Initial cool-down when the provider sends no Retry-After.",
        maxBackoffMs: "Back-off ceiling (ms)",
        maxBackoffMsHint: "Upper bound of the exponential back-off.",
        backoffJitter: "Back-off jitter (0-1)",
        backoffJitterHint: "Symmetric random jitter applied to the delay.",
        maxConcurrentRequests: "Max concurrency",
        maxConcurrentRequestsHint: "0 = unlimited; above 0, slots are handed out FIFO.",
        detectTitle: "Model discovery",
        autoDetectModels: "Auto-detect my models",
        autoDetectModelsHint: "Reads the provider and model list from the Host LLM service, custom providers (llm-pi-ai) included.",
        detectIntervalMs: "Discovery interval (ms)",
        detectIntervalMsHint: "0 = discover only when the page opens or the provider topology changes.",
        detectedProviders: "Detected providers",
        detectedModels: "Detected models",
        addDetectedProviders: "Add every provider (route-wide)",
        addDetectedModels: "Add every model (per model)",
        refreshDetect: "Detect again",
        detectedAt: "Detected at",
        detectErrors: "Discovery warnings",
        rowsTitle: "Per-route overrides",
        rowsHint: "Empty provider / model means \"all\"; exact matches win, substring patterns are the fallback.",
        provider: "Provider",
        model: "Model",
        rpm: "RPM",
        burst: "Burst",
        allProviders: "(all)",
        allModels: "(all)",
        remove: "Remove",
        addRow: "Add route",
        identityTitle: "Gateway identity rules",
        identityDesc: "Rewrite the User-Agent sent upstream, inject dynamic OpenCode ids and custom headers.",
        identityUrlPattern: "URL match substring",
        identityUa: "User-Agent",
        identityUaPlaceholder: "empty = leave untouched",
        identityDynamic: "Inject dynamic x-opencode-* ids",
        identityHeaders: "Custom headers (Name: Value; semicolon separated)",
        identityHeadersPlaceholder: "x-foo: bar; x-baz: qux",
        identityEnabled: "Enabled",
        identityAdd: "Add rule",
        presetZen: "Apply the OpenCode Zen preset",
        identityInvalid: "Invalid identity rule: ",
        invalidNumbers: "Invalid numbers: ",
        statsTitle: "Live stats",
        statsRoutes: "Routes",
        statsRejected: "Rejected",
        statsWaited: "Waited",
        statsAvgWait: "Avg wait",
        statsTotal: "Total",
        statsQueued: "Queued",
        statsCooling: "Cooling",
        statsLoading: "Loading stats…",
        statsReset: "Reset stats",
        statsResetDone: "Stats reset",
        save: "Save",
        discard: "Discard",
        resetAll: "Reset to defaults",
        resetConfirm: "Discard every custom setting and restore the defaults?",
        saved: "Saved",
        dirty: "Unsaved changes",
        failed: "Save failed",
        conflictStale: "Another window changed these settings; reloaded the current values.",
        notWritable: "These settings are not writable right now.",
        settingsMissing: "The Host has not registered this plugin's settings namespace; check that the cordis.patch.yml row id is rate-limiter-renew.",
        loading: "Loading…",
        unavailable: "Cannot reach the Host bridge endpoint.",
        stateOn: "on",
        stateOff: "off",
        dockRejected: "rejected",
        dockWaited: "waited",
        dockActive: "active",
        dockRoutes: "routes",
        dockOff: "rate limiting off",
        dockNoData: "rate limiter idle"
      }
    };

    function preferredLanguage() {
      if (typeof navigator === "undefined") return "zh";
      return String((navigator.languages && navigator.languages[0]) || navigator.language || "zh").toLowerCase();
    }

    function isEnglish() {
      return preferredLanguage().startsWith("en");
    }

    /** Fallback translator used when the locale client service is not present. */
    function localT(key) {
      const table = isEnglish() ? DICT.en : DICT.zh;
      return table[key] ?? DICT.en[key] ?? key;
    }

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    const css = [
      ".rlr_card{list-style:none;margin:0;padding:0;font-size:13px;color:var(--dsw-alias-label-primary,#1d1d1f)}",
      ".rlr_page{width:100%;max-width:none}",
      ".rlr_head{display:flex;align-items:center;gap:8px;width:100%;background:none;border:0;padding:8px 0;cursor:pointer;color:inherit;font:inherit;text-align:left}",
      ".rlr_head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0a84ff);outline-offset:2px;border-radius:6px}",
      ".rlr_caret{flex:none;transition:transform .15s ease;opacity:.6}",
      ".rlr_caret[data-open=true]{transform:rotate(90deg)}",
      ".rlr_title{font-weight:600}",
      ".rlr_badge{flex:none;font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#d2d2d7);color:var(--dsw-alias-label-secondary,#6e6e73)}",
      ".rlr_badge[data-on=true]{border-color:var(--dsw-alias-brand-primary,#0a84ff);color:var(--dsw-alias-brand-primary,#0a84ff)}",
      ".rlr_desc{color:var(--dsw-alias-label-secondary,#6e6e73);margin:0 0 10px}",
      ".rlr_body{padding:2px 0 8px}",
      ".rlr_grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px 16px;margin:6px 0 12px}",
      ".rlr_field{display:flex;flex-direction:column;gap:4px;min-width:0}",
      ".rlr_label{font-weight:500}",
      ".rlr_hint{color:var(--dsw-alias-label-tertiary,#8e8e93);font-size:11px;line-height:1.35}",
      ".rlr_input,.rlr_select,.rlr_textarea{width:100%;box-sizing:border-box;padding:5px 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#d2d2d7);background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit}",
      ".rlr_textarea{min-height:52px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}",
      ".rlr_check{display:flex;align-items:center;gap:6px;font-weight:500}",
      "details.rlr_fold{border:1px solid var(--dsw-alias-border-l2,#d2d2d7);border-radius:8px;padding:6px 10px;margin:8px 0}",
      "details.rlr_fold>summary{cursor:pointer;font-weight:600;padding:2px 0}",
      ".rlr_table{width:100%;border-collapse:collapse;margin-top:6px}",
      ".rlr_table th,.rlr_table td{padding:4px 6px;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l2,#d2d2d7);vertical-align:middle}",
      ".rlr_table th{font-weight:500;color:var(--dsw-alias-label-secondary,#6e6e73);font-size:11px;text-transform:uppercase;letter-spacing:.03em}",
      ".rlr_table td.rlr_num{text-align:right;font-variant-numeric:tabular-nums}",
      ".rlr_actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}",
      ".rlr_btn{padding:5px 11px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,#d2d2d7);background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;cursor:pointer}",
      ".rlr_btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#0a84ff)}",
      ".rlr_btn:disabled{opacity:.45;cursor:default}",
      ".rlr_btn[data-primary=true]{background:var(--dsw-alias-brand-primary,#0a84ff);border-color:transparent;color:#fff}",
      ".rlr_btn[data-danger=true]{color:var(--dsw-alias-status-danger,#ff3b30)}",
      ".rlr_note{font-size:12px;padding:5px 8px;border-radius:6px;margin:6px 0}",
      ".rlr_note[data-kind=ok]{color:var(--dsw-alias-brand-primary,#0a84ff)}",
      ".rlr_note[data-kind=warn]{color:#b26a00}",
      ".rlr_note[data-kind=error]{color:var(--dsw-alias-status-danger,#ff3b30)}",
      ".rlr_detected{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0}",
      ".rlr_chip{font-size:11px;padding:2px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#d2d2d7);background:none;color:inherit;cursor:pointer;font:inherit}",
      ".rlr_chip:hover{border-color:var(--dsw-alias-brand-primary,#0a84ff)}",
      ".rlr_chipGroup{display:flex;align-items:center;gap:6px;margin:4px 0;flex-wrap:wrap}",
      ".rlr_chipGroupName{font-weight:600;min-width:110px}",
      ".rlr_statsDock{display:block;font-size:11px;color:var(--dsw-alias-label-tertiary,#8e8e93);padding:2px 2px 0;font-variant-numeric:tabular-nums}",
      ".rlr_statsDock b{font-weight:600;color:var(--dsw-alias-label-secondary,#6e6e73)}",
      "html[data-theme=dark] .rlr_input,html[data-theme=dark] .rlr_select,html[data-theme=dark] .rlr_textarea,html[data-theme=dark] .rlr_btn{background:var(--dsw-alias-bg-layer-1,#1c1c1e)}"
    ].join("");

    function injectCss() {
      if (typeof document === "undefined") return;
      const tagId = "dsh-rate-limiter-renew/card.css";
      if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-rate-limiter-renew";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    /* ------------------------------------------------------------------ *
     * Transport
     * ------------------------------------------------------------------ */

    async function bridgeCall(path, payload) {
      try {
        const response = await fetch(BRIDGE_PREFIX + path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload ?? {})
        });
        return await response.json();
      } catch (error) {
        return { ok: false, code: "bridge-unreachable", message: String((error && error.message) || error) };
      }
    }

    /* ------------------------------------------------------------------ *
     * Tiny observable store (replaces dsh-client-store's createSnapshotStore)
     * ------------------------------------------------------------------ */

    function createStore(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        getSnapshot() {
          return value;
        },
        set(next) {
          value = next;
          for (const listener of [...listeners]) {
            try {
              listener();
            } catch {
              /* a broken renderer must not break the others */
            }
          }
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        }
      };
    }

    const statsStore = createStore(null);
    let statsTransport = null;

    async function pollStats() {
      const result = await bridgeCall("/stats", {});
      if (result && result.ok) statsStore.set(result.value);
    }

    function ensureStatsTransport() {
      if (statsTransport) return;
      void pollStats();
      if (typeof EventSource === "function") {
        let source = null;
        try {
          source = new EventSource(BRIDGE_PREFIX + "/events");
        } catch {
          source = null;
        }
        if (source) {
          const onEvent = (event) => {
            try {
              const parsed = JSON.parse(event.data);
              if (parsed && parsed.ok) statsStore.set(parsed.value);
            } catch {
              /* ignore malformed frames */
            }
          };
          source.addEventListener("snapshot", onEvent);
          source.addEventListener("stats", onEvent);
          let pollTimer = null;
          const startPolling = () => {
            if (pollTimer) return;
            pollTimer = setInterval(() => void pollStats(), 30000);
          };
          source.onerror = () => {
            try {
              source.close();
            } catch {
              /* already closed */
            }
            void pollStats();
            startPolling();
          };
          statsTransport = {
            close() {
              try {
                source.close();
              } catch {
                /* already closed */
              }
              if (pollTimer) clearInterval(pollTimer);
              pollTimer = null;
            }
          };
          return;
        }
      }
      const pollTimer = setInterval(() => void pollStats(), 30000);
      statsTransport = {
        close() {
          clearInterval(pollTimer);
        }
      };
    }

    function useStore(store) {
      const [snapshot, setSnapshot] = react.useState(() => store.getSnapshot());
      react.useEffect(() => store.subscribe(() => setSnapshot(store.getSnapshot())), [store]);
      return snapshot;
    }

    /* ------------------------------------------------------------------ *
     * Draft helpers
     * ------------------------------------------------------------------ */

    function parseHeaderList(text) {
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

    function headersToText(headers) {
      if (!Array.isArray(headers)) return "";
      return headers
        .filter((header) => header && header.name)
        .map((header) => `${header.name}: ${header.value ?? ""}`)
        .join("; ");
    }

    function intOr(value, fallback) {
      const n = Number(value);
      return Number.isFinite(n) ? Math.trunc(n) : fallback;
    }

    function numberOr(value, fallback) {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }

    function normalizeDraft(raw) {
      const source = raw && typeof raw === "object" ? raw : {};
      const draft = {
        enabled: source.enabled !== false,
        requestsPerMinute: intOr(source.requestsPerMinute, DEFAULTS.requestsPerMinute),
        burst: Math.max(1, intOr(source.burst, DEFAULTS.burst)),
        mode: source.mode === "reject" ? "reject" : "wait",
        maxWaitMs: Math.max(0, intOr(source.maxWaitMs, DEFAULTS.maxWaitMs)),
        upstream429Backoff: source.upstream429Backoff !== false,
        backoffMs: Math.max(0, intOr(source.backoffMs, DEFAULTS.backoffMs)),
        maxBackoffMs: Math.max(0, intOr(source.maxBackoffMs, DEFAULTS.maxBackoffMs)),
        backoffJitter: Math.min(1, Math.max(0, numberOr(source.backoffJitter, DEFAULTS.backoffJitter))),
        maxConcurrentRequests: Math.max(0, intOr(source.maxConcurrentRequests, DEFAULTS.maxConcurrentRequests)),
        autoDetectModels: source.autoDetectModels !== false,
        detectIntervalMs: Math.max(0, intOr(source.detectIntervalMs, DEFAULTS.detectIntervalMs)),
        models: Array.isArray(source.models)
          ? source.models.map((row) => ({
              provider: String((row && row.provider) ?? ""),
              model: String((row && row.model) ?? ""),
              requestsPerMinute: intOr(row && row.requestsPerMinute, DEFAULTS.requestsPerMinute),
              burst: Math.max(1, intOr(row && row.burst, DEFAULTS.burst))
            }))
          : [],
        identityRules: Array.isArray(source.identityRules)
          ? source.identityRules.map((rule) => ({
              urlPattern: String((rule && rule.urlPattern) ?? ""),
              userAgent: String((rule && rule.userAgent) ?? ""),
              dynamicIds: Boolean(rule && rule.dynamicIds === true),
              enabled: !(rule && rule.enabled === false),
              headersText: headersToText(rule && rule.headers)
            }))
          : []
      };
      return draft;
    }

    function serializeDraft(draft) {
      return {
        enabled: draft.enabled === true,
        requestsPerMinute: Math.max(0, intOr(draft.requestsPerMinute, DEFAULTS.requestsPerMinute)),
        burst: Math.max(1, intOr(draft.burst, DEFAULTS.burst)),
        mode: draft.mode === "reject" ? "reject" : "wait",
        maxWaitMs: Math.max(0, intOr(draft.maxWaitMs, DEFAULTS.maxWaitMs)),
        upstream429Backoff: draft.upstream429Backoff !== false,
        backoffMs: Math.max(0, intOr(draft.backoffMs, DEFAULTS.backoffMs)),
        maxBackoffMs: Math.max(0, intOr(draft.maxBackoffMs, DEFAULTS.maxBackoffMs)),
        backoffJitter: Math.min(1, Math.max(0, numberOr(draft.backoffJitter, DEFAULTS.backoffJitter))),
        maxConcurrentRequests: Math.max(0, intOr(draft.maxConcurrentRequests, DEFAULTS.maxConcurrentRequests)),
        autoDetectModels: draft.autoDetectModels !== false,
        detectIntervalMs: Math.max(0, intOr(draft.detectIntervalMs, DEFAULTS.detectIntervalMs)),
        models: draft.models
          .map((row) => ({
            provider: String(row.provider ?? "").trim(),
            model: String(row.model ?? "").trim(),
            requestsPerMinute: Math.max(0, intOr(row.requestsPerMinute, DEFAULTS.requestsPerMinute)),
            burst: Math.max(1, intOr(row.burst, DEFAULTS.burst))
          }))
          .filter((row) => row.provider.length > 0 || row.model.length > 0),
        identityRules: draft.identityRules
          .filter((rule) => String(rule.urlPattern ?? "").trim().length > 0)
          .map((rule) => ({
            urlPattern: String(rule.urlPattern).trim(),
            userAgent: String(rule.userAgent ?? ""),
            dynamicIds: rule.dynamicIds === true,
            headers: parseHeaderList(rule.headersText) ?? [],
            enabled: rule.enabled !== false
          }))
      };
    }

    function draftIssues(draft, t) {
      const numbers = [];
      const check = (label, value, min) => {
        if (!Number.isFinite(Number(value)) || Number(value) < min) numbers.push(label);
      };
      check(t("requestsPerMinute"), draft.requestsPerMinute, 0);
      check(t("burst"), draft.burst, 1);
      check(t("maxWaitMs"), draft.maxWaitMs, 0);
      check(t("backoffMs"), draft.backoffMs, 0);
      check(t("maxBackoffMs"), draft.maxBackoffMs, 0);
      check(t("backoffJitter"), draft.backoffJitter, 0);
      check(t("maxConcurrentRequests"), draft.maxConcurrentRequests, 0);
      check(t("detectIntervalMs"), draft.detectIntervalMs, 0);
      for (const row of draft.models) {
        check(`${t("rpm")} (${row.provider || "*"}/${row.model || "*"})`, row.requestsPerMinute, 0);
        check(`${t("burst")} (${row.provider || "*"}/${row.model || "*"})`, row.burst, 1);
      }
      const identity = [];
      for (let index = 0; index < draft.identityRules.length; index += 1) {
        const rule = draft.identityRules[index];
        if (String(rule.urlPattern ?? "").trim().length === 0) identity.push(`${index + 1}: ${t("identityUrlPattern")}`);
        if (parseHeaderList(rule.headersText) === null) identity.push(`${index + 1}: ${t("identityHeaders")}`);
      }
      return { numbers, identity };
    }

    function detectedModelIds(detection, providerId) {
      if (!detection || !Array.isArray(detection.providers)) return [];
      const provider = detection.providers.find((entry) => entry.id === providerId);
      if (provider) return provider.models.map((model) => model.id);
      const all = new Set();
      for (const entry of detection.providers) for (const model of entry.models) all.add(model.id);
      return [...all];
    }

    /** Summary shown on the plugin row without touching the bridge. */
    let lastDetectionSummary = "";
    function summaryText() {
      if (lastDetectionSummary) return lastDetectionSummary;
      return isEnglish()
        ? "Per (provider, model) token bucket · wait/reject · live stats"
        : "按 (供應商, 模型) 令牌桶限速 · 等待/拒絕 · 即時統計";
    }

    /* ------------------------------------------------------------------ *
     * Components
     * ------------------------------------------------------------------ */

    function note(kind, text) {
      if (!text) return null;
      return h("div", { className: "rlr_note", "data-kind": kind }, text);
    }

    function field(label, hint, control) {
      return h(
        "div",
        { className: "rlr_field" },
        h("span", { className: "rlr_label" }, label),
        control,
        hint ? h("span", { className: "rlr_hint" }, hint) : null
      );
    }

    function numberInput(value, onChange) {
      return h("input", {
        className: "rlr_input",
        type: "number",
        value: Number.isFinite(Number(value)) ? value : "",
        onChange: (event) => onChange(event.target.value === "" ? "" : Number(event.target.value))
      });
    }

    function checkInput(label, checked, onChange) {
      return h(
        "label",
        { className: "rlr_check" },
        h("input", { type: "checkbox", checked: checked === true, onChange: (event) => onChange(event.target.checked) }),
        h("span", null, label)
      );
    }

    function RateLimiterCard(props) {
      const t = props.t;
      const stats = useStore(statsStore);
      const [draft, setDraft] = react.useState(null);
      const [loaded, setLoaded] = react.useState(null);
      const [revision, setRevision] = react.useState(0);
      const [writable, setWritable] = react.useState(true);
      const [status, setStatus] = react.useState("loading");
      const [detection, setDetection] = react.useState({ providers: [], errors: [], detectedAt: 0 });
      const [notice, setNotice] = react.useState(null);
      const [saving, setSaving] = react.useState(false);
      const [open, setOpen] = react.useState(props.page === true);
      const [detecting, setDetecting] = react.useState(false);

      const applyDescriptor = react.useCallback((value) => {
        const next = normalizeDraft(value.value);
        setDraft(next);
        setLoaded(next);
        setRevision(value.revision);
        setWritable(value.writable !== false);
        setStatus("ready");
      }, []);

      const load = react.useCallback(async () => {
        const result = await bridgeCall("/describe", {});
        if (result && result.ok) {
          applyDescriptor(result.value);
          setNotice(null);
          return;
        }
        setStatus("error");
        setNotice({
          kind: "error",
          text: result && result.code === "settings-not-exposed" ? t("settingsMissing") : (result && result.message) || t("unavailable")
        });
      }, [t, applyDescriptor]);

      const loadModels = react.useCallback(async (force) => {
        setDetecting(true);
        const result = await bridgeCall("/models", { force: force === true });
        setDetecting(false);
        if (result && result.ok) {
          setDetection(result.value);
          const providers = result.value.providers.length;
          let models = 0;
          for (const provider of result.value.providers) models += provider.models.length;
          lastDetectionSummary = isEnglish()
            ? `${providers} providers · ${models} models detected · wait/reject · live stats`
            : `偵測到 ${providers} 個供應商 · ${models} 個模型 · 等待/拒絕 · 即時統計`;
        }
      }, []);

      react.useEffect(() => {
        ensureStatsTransport();
        void load();
        void loadModels(false);
      }, [load, loadModels]);

      if (status === "loading") {
        return h("div", { className: "rlr_card" }, h("div", { className: "rlr_hint" }, t("loading")));
      }
      if (status === "error" || !draft) {
        return h(
          "div",
          { className: "rlr_card" },
          h("div", { className: "rlr_title" }, t("title")),
          note("error", notice ? notice.text : t("unavailable")),
          h(
            "div",
            { className: "rlr_actions" },
            h("button", { className: "rlr_btn", type: "button", onClick: () => void load() }, t("refreshDetect"))
          )
        );
      }

      const issues = draftIssues(draft, t);
      const problemCount = issues.numbers.length + issues.identity.length;
      const dirty = loaded !== null && JSON.stringify(serializeDraft(draft)) !== JSON.stringify(serializeDraft(loaded));
      const providerIds = (detection.providers || []).map((provider) => provider.id);

      const edit = (patch) => setDraft((previous) => Object.assign({}, previous, patch));
      const editRow = (index, patch) =>
        setDraft((previous) => {
          const models = previous.models.slice();
          models[index] = Object.assign({}, models[index], patch);
          return Object.assign({}, previous, { models });
        });
      const editRule = (index, patch) =>
        setDraft((previous) => {
          const identityRules = previous.identityRules.slice();
          identityRules[index] = Object.assign({}, identityRules[index], patch);
          return Object.assign({}, previous, { identityRules });
        });

      const save = async () => {
        setSaving(true);
        const result = await bridgeCall("/replace", {
          section: serializeDraft(draft),
          expectedRevision: revision
        });
        setSaving(false);
        if (result && result.ok) {
          applyDescriptor(result.value);
          setNotice({ kind: "ok", text: t("saved") });
          return;
        }
        if (result && result.code === "settings-conflict") {
          setNotice({ kind: "warn", text: t("conflictStale") });
          await load();
          return;
        }
        setNotice({ kind: "error", text: (result && result.message) || t("failed") });
      };

      const resetAll = async () => {
        if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(t("resetConfirm"))) return;
        setSaving(true);
        const result = await bridgeCall("/reset", { expectedRevision: revision });
        setSaving(false);
        if (result && result.ok) {
          applyDescriptor(result.value);
          setNotice({ kind: "ok", text: t("saved") });
          return;
        }
        setNotice({ kind: "error", text: (result && result.message) || t("failed") });
      };

      const addDetectedProviders = () =>
        setDraft((previous) => {
          const models = previous.models.slice();
          for (const providerId of providerIds) {
            if (models.some((row) => row.provider === providerId && row.model === "")) continue;
            models.push({ provider: providerId, model: "", requestsPerMinute: previous.requestsPerMinute, burst: previous.burst });
          }
          return Object.assign({}, previous, { models });
        });

      const addDetectedModels = () =>
        setDraft((previous) => {
          const models = previous.models.slice();
          for (const provider of detection.providers || []) {
            for (const model of provider.models || []) {
              if (models.some((row) => row.provider === provider.id && row.model === model.id)) continue;
              models.push({
                provider: provider.id,
                model: model.id,
                requestsPerMinute: previous.requestsPerMinute,
                burst: previous.burst
              });
            }
          }
          return Object.assign({}, previous, { models });
        });

      /* ---- basic grid ---- */
      const basicGrid = h(
        "div",
        { className: "rlr_grid" },
        field(t("enabled"), t("enabledHint"), checkInput(t("enabled"), draft.enabled, (value) => edit({ enabled: value }))),
        field(t("defaultRpm"), t("defaultRpmHint"), numberInput(draft.requestsPerMinute, (value) => edit({ requestsPerMinute: value }))),
        field(t("defaultBurst"), t("defaultBurstHint"), numberInput(draft.burst, (value) => edit({ burst: value }))),
        field(
          t("mode"),
          null,
          h(
            "select",
            {
              className: "rlr_select",
              value: draft.mode,
              onChange: (event) => edit({ mode: event.target.value })
            },
            h("option", { value: "wait" }, t("modeWait")),
            h("option", { value: "reject" }, t("modeReject"))
          )
        ),
        field(t("maxWaitMs"), t("maxWaitMsHint"), numberInput(draft.maxWaitMs, (value) => edit({ maxWaitMs: value }))),
        field(t("maxConcurrentRequests"), t("maxConcurrentRequestsHint"), numberInput(draft.maxConcurrentRequests, (value) => edit({ maxConcurrentRequests: value }))),
        field(t("upstream429Backoff"), t("upstream429BackoffHint"), checkInput(t("upstream429Backoff"), draft.upstream429Backoff, (value) => edit({ upstream429Backoff: value }))),
        field(t("backoffMs"), t("backoffMsHint"), numberInput(draft.backoffMs, (value) => edit({ backoffMs: value }))),
        field(t("maxBackoffMs"), t("maxBackoffMsHint"), numberInput(draft.maxBackoffMs, (value) => edit({ maxBackoffMs: value }))),
        field(t("backoffJitter"), t("backoffJitterHint"), numberInput(draft.backoffJitter, (value) => edit({ backoffJitter: value })))
      );

      /* ---- detection ---- */
      const detectionSection = h(
        "div",
        null,
        h(
          "div",
          { className: "rlr_grid" },
          field(t("autoDetectModels"), t("autoDetectModelsHint"), checkInput(t("autoDetectModels"), draft.autoDetectModels, (value) => edit({ autoDetectModels: value }))),
          field(t("detectIntervalMs"), t("detectIntervalMsHint"), numberInput(draft.detectIntervalMs, (value) => edit({ detectIntervalMs: value })))
        ),
        h(
          "div",
          { className: "rlr_actions" },
          h("button", { className: "rlr_btn", type: "button", disabled: detecting, onClick: () => void loadModels(true) }, t("refreshDetect")),
          h("button", { className: "rlr_btn", type: "button", disabled: providerIds.length === 0, onClick: addDetectedProviders }, t("addDetectedProviders")),
          h("button", { className: "rlr_btn", type: "button", disabled: providerIds.length === 0, onClick: addDetectedModels }, t("addDetectedModels")),
          h(
            "span",
            { className: "rlr_hint" },
            `${t("detectedAt")}: ${detection.detectedAt ? new Date(detection.detectedAt).toLocaleTimeString() : "—"}`
          )
        ),
        h("div", { className: "rlr_hint" }, `${t("detectedProviders")}: ${providerIds.length}`),
        ...(detection.providers || []).map((provider) =>
          h(
            "div",
            { className: "rlr_chipGroup", key: `d-${provider.id}` },
            h("span", { className: "rlr_chipGroupName" }, provider.name === provider.id ? provider.id : `${provider.name} (${provider.id})`),
            ...(provider.models || []).map((model) =>
              h(
                "button",
                {
                  className: "rlr_chip",
                  type: "button",
                  key: `${provider.id}/${model.id}`,
                  title: `${provider.id} / ${model.id}`,
                  onClick: () =>
                    setDraft((previous) => {
                      const models = previous.models.slice();
                      if (!models.some((row) => row.provider === provider.id && row.model === model.id)) {
                        models.push({
                          provider: provider.id,
                          model: model.id,
                          requestsPerMinute: previous.requestsPerMinute,
                          burst: previous.burst
                        });
                      }
                      return Object.assign({}, previous, { models });
                    })
                },
                model.id
              )
            )
          )
        ),
        (detection.providers || []).length === 0 ? h("div", { className: "rlr_hint" }, t("detectErrors")) : null,
        ...(detection.errors || []).map((error) => note("warn", `${error.where}: ${error.message}`))
      );

      /* ---- per-route rows ---- */
      const rows = h(
        "div",
        null,
        h("div", { className: "rlr_hint" }, t("rowsHint")),
        h(
          "table",
          { className: "rlr_table" },
          h(
            "thead",
            null,
            h(
              "tr",
              null,
              h("th", null, t("provider")),
              h("th", null, t("model")),
              h("th", null, t("rpm")),
              h("th", null, t("burst")),
              h("th", null, "")
            )
          ),
          h(
            "tbody",
            null,
            ...draft.models.map((row, index) =>
              h(
                "tr",
                { key: `row-${index}` },
                h(
                  "td",
                  null,
                  h(
                    "select",
                    {
                      className: "rlr_select",
                      value: providerIds.includes(row.provider) ? row.provider : "",
                      onChange: (event) => editRow(index, { provider: event.target.value })
                    },
                    h("option", { value: "" }, t("allProviders")),
                    ...providerIds.map((providerId) => h("option", { key: providerId, value: providerId }, providerId)),
                    row.provider && !providerIds.includes(row.provider)
                      ? h("option", { value: row.provider }, row.provider)
                      : null
                  )
                ),
                h(
                  "td",
                  null,
                  h("input", {
                    className: "rlr_input",
                    type: "text",
                    list: `rlr-models-${index}`,
                    value: row.model,
                    placeholder: t("allModels"),
                    onChange: (event) => editRow(index, { model: event.target.value })
                  }),
                  h(
                    "datalist",
                    { id: `rlr-models-${index}` },
                    ...detectedModelIds(detection, row.provider).map((modelId) =>
                      h("option", { key: modelId, value: modelId })
                    )
                  )
                ),
                h("td", null, numberInput(row.requestsPerMinute, (value) => editRow(index, { requestsPerMinute: value }))),
                h("td", null, numberInput(row.burst, (value) => editRow(index, { burst: value }))),
                h(
                  "td",
                  null,
                  h(
                    "button",
                    {
                      className: "rlr_btn",
                      type: "button",
                      "data-danger": "true",
                      onClick: () =>
                        setDraft((previous) => ({
                          ...previous,
                          models: previous.models.filter((__, position) => position !== index)
                        }))
                    },
                    t("remove")
                  )
                )
              )
            )
          )
        ),
        h(
          "div",
          { className: "rlr_actions" },
          h(
            "button",
            {
              className: "rlr_btn",
              type: "button",
              onClick: () =>
                setDraft((previous) => ({
                  ...previous,
                  models: previous.models.concat([
                    { provider: "", model: "", requestsPerMinute: previous.requestsPerMinute, burst: previous.burst }
                  ])
                }))
            },
            t("addRow")
          )
        )
      );

      /* ---- identity rules ---- */
      const identity = h(
        "div",
        null,
        h("div", { className: "rlr_hint" }, t("identityDesc")),
        ...draft.identityRules.map((rule, index) =>
          h(
            "div",
            { key: `rule-${index}` },
            h(
              "div",
              { className: "rlr_grid" },
              field(
                t("identityUrlPattern"),
                null,
                h("input", {
                  className: "rlr_input",
                  type: "text",
                  value: rule.urlPattern,
                  placeholder: "opencode.ai/zen",
                  onChange: (event) => editRule(index, { urlPattern: event.target.value })
                })
              ),
              field(
                t("identityUa"),
                null,
                h("input", {
                  className: "rlr_input",
                  type: "text",
                  value: rule.userAgent,
                  placeholder: t("identityUaPlaceholder"),
                  onChange: (event) => editRule(index, { userAgent: event.target.value })
                })
              ),
              field(
                t("identityHeaders"),
                null,
                h("textarea", {
                  className: "rlr_textarea",
                  value: rule.headersText,
                  placeholder: t("identityHeadersPlaceholder"),
                  onChange: (event) => editRule(index, { headersText: event.target.value })
                })
              ),
              field(t("identityEnabled"), null, checkInput(t("identityEnabled"), rule.enabled, (value) => editRule(index, { enabled: value }))),
              field(t("identityDynamic"), null, checkInput(t("identityDynamic"), rule.dynamicIds, (value) => editRule(index, { dynamicIds: value })))
            ),
            h(
              "div",
              { className: "rlr_actions" },
              h(
                "button",
                {
                  className: "rlr_btn",
                  type: "button",
                  "data-danger": "true",
                  onClick: () =>
                    setDraft((previous) => ({
                      ...previous,
                      identityRules: previous.identityRules.filter((__, position) => position !== index)
                    }))
                },
                t("remove")
              )
            )
          )
        ),
        h(
          "div",
          { className: "rlr_actions" },
          h(
            "button",
            {
              className: "rlr_btn",
              type: "button",
              onClick: () =>
                setDraft((previous) => ({
                  ...previous,
                  identityRules: previous.identityRules.concat([
                    { urlPattern: "", userAgent: "", dynamicIds: false, enabled: true, headersText: "" }
                  ])
                }))
            },
            t("identityAdd")
          ),
          h(
            "button",
            {
              className: "rlr_btn",
              type: "button",
              onClick: () =>
                setDraft((previous) => ({
                  ...previous,
                  identityRules: previous.identityRules.concat([Object.assign({ headersText: "" }, OPENCODE_PRESET)])
                }))
            },
            t("presetZen")
          )
        )
      );

      /* ---- stats ---- */
      const aggregate = (stats && stats.aggregate) || null;
      const statsSection = h(
        "div",
        null,
        !aggregate
          ? h("div", { className: "rlr_hint" }, t("statsLoading"))
          : h(
              "div",
              { className: "rlr_grid" },
              field(t("statsRoutes"), null, h("span", null, String(aggregate.routes))),
              field(t("statsTotal"), null, h("span", null, String(aggregate.reserved))),
              field(t("statsRejected"), null, h("span", null, String(aggregate.rejected))),
              field(t("statsWaited"), null, h("span", null, String(aggregate.waited))),
              field(t("statsAvgWait"), null, h("span", null, `${Math.round(Number(aggregate.avgWaitMs) || 0)} ms`)),
              field(t("statsQueued"), null, h("span", null, String(aggregate.queuedNow))),
              field(t("statsCooling"), null, h("span", null, String(aggregate.coolingRoutes)))
            ),
        aggregate && stats.routes.length > 0
          ? h(
              "table",
              { className: "rlr_table" },
              h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  h("th", null, t("provider")),
                  h("th", null, t("model")),
                  h("th", null, t("rpm")),
                  h("th", null, t("statsTotal")),
                  h("th", null, t("statsWaited")),
                  h("th", null, t("statsRejected")),
                  h("th", null, t("statsQueued")),
                  h("th", null, t("statsAvgWait"))
                )
              ),
              h(
                "tbody",
                null,
                ...stats.routes.map((route) =>
                  h(
                    "tr",
                    { key: `${route.provider}/${route.model}` },
                    h("td", null, route.provider),
                    h("td", null, route.model),
                    h("td", { className: "rlr_num" }, route.unlimited ? "∞" : String(route.requestsPerMinute)),
                    h("td", { className: "rlr_num" }, String(route.reserved)),
                    h("td", { className: "rlr_num" }, String(route.waited)),
                    h("td", { className: "rlr_num" }, String(route.rejected)),
                    h("td", { className: "rlr_num" }, String(route.queuedNow)),
                    h("td", { className: "rlr_num" }, `${Math.round(Number(route.avgWaitMs) || 0)} ms`)
                  )
                )
              )
            )
          : null,
        h(
          "div",
          { className: "rlr_actions" },
          h(
            "button",
            {
              className: "rlr_btn",
              type: "button",
              onClick: async () => {
                await bridgeCall("/stats-reset", {});
                void pollStats();
                setNotice({ kind: "ok", text: t("statsResetDone") });
              }
            },
            t("statsReset")
          )
        )
      );

      const body = h(
        "div",
        { className: "rlr_body" },
        note("error", issues.numbers.length > 0 ? `${t("invalidNumbers")}${issues.numbers.join(", ")}` : null),
        note("error", issues.identity.length > 0 ? `${t("identityInvalid")}${issues.identity.join(", ")}` : null),
        !writable ? note("warn", t("notWritable")) : null,
        notice ? note(notice.kind, notice.text) : null,
        basicGrid,
        h("details", { className: "rlr_fold" }, h("summary", null, `${t("detectTitle")} · ${providerIds.length}`), detectionSection),
        h("details", { className: "rlr_fold" }, h("summary", null, `${t("rowsTitle")} · ${draft.models.length}`), rows),
        h("details", { className: "rlr_fold" }, h("summary", null, `${t("identityTitle")} · ${draft.identityRules.length}`), identity),
        h("details", { className: "rlr_fold" }, h("summary", null, t("statsTitle")), statsSection),
        h(
          "div",
          { className: "rlr_actions" },
          h(
            "button",
            { className: "rlr_btn", type: "button", disabled: !dirty || saving, onClick: () => setDraft(normalizeDraft(loaded)) },
            t("discard")
          ),
          h("button", { className: "rlr_btn", type: "button", disabled: saving, "data-danger": "true", onClick: () => void resetAll() }, t("resetAll")),
          h(
            "button",
            {
              className: "rlr_btn",
              type: "button",
              "data-primary": "true",
              disabled: saving || problemCount > 0 || !writable || !dirty,
              onClick: () => void save()
            },
            t("save")
          ),
          dirty ? h("span", { className: "rlr_hint" }, t("dirty")) : null
        )
      );

      return h(
        "div",
        { className: props.page === true ? "rlr_card rlr_page" : "rlr_card" },
        h(
          "button",
          {
            className: "rlr_head",
            type: "button",
            "aria-expanded": open ? "true" : "false",
            onClick: () => setOpen((value) => !value)
          },
          h("span", { className: "rlr_caret", "data-open": open ? "true" : "false" }, "▶"),
          h("span", { className: "rlr_title" }, t("title")),
          h("span", { className: "rlr_badge", "data-on": draft.enabled ? "true" : "false" }, draft.enabled ? t("stateOn") : t("stateOff")),
          h("span", { className: "rlr_badge" }, draft.mode === "reject" ? t("modeReject") : t("modeWait")),
          h("span", { className: "rlr_badge" }, `${draft.requestsPerMinute}/min · ${draft.burst}`)
        ),
        open ? h("div", null, h("div", { className: "rlr_desc" }, t("desc")), body) : null
      );
    }

    function ComposerStatsLine(props) {
      const t = props.t;
      const stats = useStore(statsStore);
      react.useEffect(() => {
        ensureStatsTransport();
      }, []);
      if (!stats || !stats.aggregate) {
        return h("span", { className: "rlr_statsDock" }, t("dockNoData"));
      }
      const aggregate = stats.aggregate;
      const enabled = !stats.config || stats.config.enabled !== false;
      if (!enabled) return h("span", { className: "rlr_statsDock" }, t("dockOff"));
      const detail = (stats.routes || [])
        .filter((route) => route.reserved > 0 || route.queuedNow > 0 || route.coolMs > 0)
        .map(
          (route) =>
            `${route.provider}/${route.model}: ${route.reserved} total, ${route.waited} ${t("dockWaited")}, ${
              route.rejected
            } ${t("dockRejected")}, ${route.queuedNow} ${t("dockQueued")}, ${Math.round(route.coolMs)}ms cool`
        )
        .join("\n");
      return h(
        "span",
        {
          className: "rlr_statsDock",
          title: detail || t("dockNoData")
        },
        h("b", null, "⏱"),
        ` ${stats.config ? stats.config.requestsPerMinute : "-"}/min ×${stats.config ? stats.config.burst : "-"} · `,
        `${aggregate.reserved} ${t("statsTotal")} · ${aggregate.waited} ${t("dockWaited")} · ${aggregate.rejected} ${t(
          "dockRejected"
        )} · ${aggregate.queuedNow} ${t("statsQueued")} · ${aggregate.routes} ${t("dockRoutes")}`
      );
    }

    /* ------------------------------------------------------------------ *
     * Entry point
     * ------------------------------------------------------------------ */

    function apply(ctx) {
      injectCss();

      let t = localT;
      const locale = typeof ctx.get === "function" ? ctx.get("locale") : undefined;
      if (locale && typeof locale.register === "function" && typeof locale.bind === "function") {
        try {
          ctx.effect(() => locale.register(NS, { zh: DICT.zh, en: DICT.en }), "rate-limiter-renew: dictionaries");
          t = locale.bind(NS);
        } catch {
          t = localT;
        }
      }

      if (!ctx.slots || typeof ctx.slots.inject !== "function" || typeof ctx.slots.register !== "function") {
        return;
      }

      // Plugin row configuration page (rc.1+: the old settings.plugin.item seat is gone).
      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register({ name: "plugins.row.config", key: ROW_KEY }, (slotProps) =>
          slotProps && slotProps.view === "summary" ? summaryText() : h(RateLimiterCard, { t, page: true })
        )
      );

      // Ambient one-line live stats under the composer card.
      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          { name: "conversation.composer.dock", id: "rate-limiter-renew/stats-line", order: 40 },
          () => h(ComposerStatsLine, { t })
        )
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.DICT = DICT;
    exports.NS = NS;
    exports.ROW_KEY = ROW_KEY;
    return module.exports;
  }
});
