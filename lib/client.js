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
        scope: "限速範圍",
        scopeHint: "決定哪些路由會被限速。「只為路由覆寫開」時，沒有對應覆寫列的路由完全不受影響。",
        scopeAll: "全部都開（所有路由）",
        scopeOverrides: "只為路由覆寫開",
        scopeOff: "全部關",
        scopeOffNote: "限速已全部關閉，所有請求直接放行。",
        scopeOverridesNote: "只有符合覆寫列的路由會受限速；其他路由直接放行。",
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
        detectTitle: "已加入的供應商與模型",
        autoDetectModels: "自動偵測我的模型",
        autoDetectModelsHint: "只讀取你在「模型」設定頁已加入的 provider 與 model（listProviders + listModels）；尚未加入的目錄項目與候選模型不會列出。",
        detectIntervalMs: "偵測間隔（毫秒）",
        detectIntervalMsHint: "0 = 只在開啟頁面或 provider 拓撲變動時偵測。",
        detectedProviders: "偵測到的供應商",
        detectedModels: "偵測到的模型",
        addDetectedProviders: "加入所有供應商（整條路由）",
        addDetectedModels: "加入所有模型（逐模型）",
        refreshDetect: "重新偵測",
        detectedAt: "偵測時間",
        detectErrors: "偵測警告",
        detectEmpty: "尚未偵測到已加入的供應商；請先在「模型」設定頁加入 provider 與 model。",
        alreadyAdded: "已加入",
        noModels: "未回報模型",
        rowsTitle: "每路由覆寫",
        rowsHint: "provider / model 留空代表「全部」；先精確比對，再退回子串比對。",
        provider: "供應商",
        model: "模型",
        rpm: "RPM",
        burst: "突發",
        allProviders: "（全部）",
        allModels: "（全部）",
        browseModel: "選擇模型…",
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
        retry: "重新載入",
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
        scope: "Limit scope",
        scopeHint: "Which routes the limiter applies to. With \"only routes with an override\", a route that matches no override row is left completely untouched.",
        scopeAll: "On for every route",
        scopeOverrides: "Only routes with an override",
        scopeOff: "Off (all routes)",
        scopeOffNote: "The limiter is off — every request passes straight through.",
        scopeOverridesNote: "Only routes matching an override row are limited; every other route passes straight through.",
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
        detectTitle: "Added providers & models",
        autoDetectModels: "Auto-detect my models",
        autoDetectModelsHint: "Reads only the providers and models you already added on the Models settings page (listProviders + listModels); dormant directory entries and candidate models are never listed.",
        detectIntervalMs: "Discovery interval (ms)",
        detectIntervalMsHint: "0 = discover only when the page opens or the provider topology changes.",
        detectedProviders: "Detected providers",
        detectedModels: "Detected models",
        addDetectedProviders: "Add every provider (route-wide)",
        addDetectedModels: "Add every model (per model)",
        refreshDetect: "Detect again",
        detectedAt: "Detected at",
        detectErrors: "Discovery warnings",
        detectEmpty: "No added providers detected yet — add a provider and a model on the Models settings page first.",
        alreadyAdded: "already added",
        noModels: "No models advertised",
        rowsTitle: "Per-route overrides",
        rowsHint: "Empty provider / model means \"all\"; exact matches win, substring patterns are the fallback.",
        provider: "Provider",
        model: "Model",
        rpm: "RPM",
        burst: "Burst",
        allProviders: "(all)",
        allModels: "(all)",
        browseModel: "Pick a model…",
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
        retry: "Reload",
        stateOn: "on",
        stateOff: "off",
        dockRejected: "rejected",
        dockWaited: "waited",
        dockQueued: "queued",
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

    /*
     * Every colour comes from a documented DSH theme token
     * (`cordis_inspect_query {platform:"client",provider:"Theme",method:"listTokens"}`),
     * so the card follows the app's light/dark theme without a manual override.
     * The hex values are light-theme fallbacks only, used if a token is missing.
     */
    const css = [
      /* ---- surface + header ---- */
      ".rlr_card{list-style:none;margin:0;padding:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#1d1d1f)}",
      ".rlr_page{width:100%;max-width:none}",
      ".rlr_head{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;background:transparent;border:0;border-radius:12px;padding:10px 12px;cursor:pointer;color:inherit;font:inherit;text-align:left;transition:background .15s ease}",
      ".rlr_head:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.04))}",
      ".rlr_head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0a84ff);outline-offset:2px}",
      ".rlr_caret{flex:none;display:inline-flex;justify-content:center;width:14px;opacity:.55;transition:transform .18s ease}",
      ".rlr_caret[data-open=true]{transform:rotate(90deg)}",
      ".rlr_heading{display:flex;flex-direction:column;gap:1px;min-width:0}",
      ".rlr_title{font-weight:650;font-size:14px;letter-spacing:-.01em}",
      ".rlr_sub{font-size:11px;color:var(--dsw-alias-label-secondary,#6e6e73)}",
      ".rlr_badges{margin-left:auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}",
      ".rlr_badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:500;padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,#e5e5ea);color:var(--dsw-alias-label-secondary,#6e6e73);white-space:nowrap}",
      ".rlr_badge b{font-weight:650;color:var(--dsw-alias-label-primary,#1d1d1f)}",
      ".rlr_dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary,#8e8e93)}",
      ".rlr_badge[data-on=true]{border-color:var(--dsw-alias-state-success-primary,#1a7f37)}",
      ".rlr_badge[data-on=true] .rlr_dot{background:var(--dsw-alias-state-success-primary,#1a7f37)}",
      ".rlr_badge[data-on=false] .rlr_dot{background:var(--dsw-alias-state-idle-primary,#8e8e93)}",
      ".rlr_desc{color:var(--dsw-alias-label-secondary,#6e6e73);margin:0 0 12px;font-size:12px}",
      ".rlr_body{padding:2px 0 4px}",
      ".rlr_state{padding:12px}",
      ".rlr_state .rlr_hint{display:flex;align-items:center;gap:8px}",
      ".rlr_state .rlr_hint::before{content:\"\";width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary,#8e8e93);animation:rlr-pulse 1.1s ease-in-out infinite}",
      "@keyframes rlr-pulse{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}",

      /* ---- fields ---- */
      ".rlr_grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px 16px;margin:2px 0 12px}",
      ".rlr_field{display:flex;flex-direction:column;gap:5px;min-width:0}",
      ".rlr_label{font-weight:550;font-size:12px;color:var(--dsw-alias-label-primary,#1d1d1f)}",
      ".rlr_hint{color:var(--dsw-alias-label-secondary,#6e6e73);font-size:11px;line-height:1.4}",
      ".rlr_input,.rlr_select,.rlr_textarea{width:100%;box-sizing:border-box;padding:6px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d2d2d7);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,inherit);font:inherit;transition:border-color .15s ease,box-shadow .15s ease}",
      ".rlr_input:hover,.rlr_select:hover,.rlr_textarea:hover{border-color:var(--dsw-alias-border-l1,#c7c7cc)}",
      ".rlr_input:focus,.rlr_select:focus,.rlr_textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#0a84ff);box-shadow:0 0 0 3px var(--dsw-alias-bg-layer-2,rgba(10,132,255,.16))}",
      ".rlr_input::placeholder,.rlr_textarea::placeholder{color:var(--dsw-alias-label-secondary,#8e8e93);opacity:.7}",
      ".rlr_pair{display:flex;align-items:center;gap:6px}",
      ".rlr_pair .rlr_input{flex:1 1 auto;min-width:0}",
      ".rlr_pair .rlr_pick{width:auto;flex:0 0 auto;max-width:10rem}",
      ".rlr_textarea{min-height:56px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}",
      ".rlr_check{display:inline-flex;align-items:center;gap:7px;font-weight:550;font-size:12px;cursor:pointer;padding:5px 0}",
      ".rlr_check input{accent-color:var(--dsw-alias-brand-primary,#0a84ff);width:14px;height:14px;cursor:pointer}",

      /* ---- collapsible section cards ---- */
      "details.rlr_fold{border:1px solid var(--dsw-alias-border-l1,#e5e5ea);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);margin:0 0 10px;overflow:hidden}",
      "details.rlr_fold>summary{display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;font-size:13px;padding:10px 12px;list-style:none;user-select:none}",
      "details.rlr_fold>summary::-webkit-details-marker{display:none}",
      "details.rlr_fold>summary:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.04))}",
      "details.rlr_fold>summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0a84ff);outline-offset:-2px}",
      "details.rlr_fold>summary::before{content:attr(data-icon);flex:none;opacity:.7;font-size:12px}",
      "details.rlr_fold>summary::after{content:\"\\25BE\";margin-left:auto;opacity:.5;font-size:10px;transition:transform .18s ease}",
      "details.rlr_fold[open]>summary{border-bottom:1px solid var(--dsw-alias-border-l1,#e5e5ea)}",
      "details.rlr_fold[open]>summary::after{transform:rotate(180deg)}",
      ".rlr_foldBody{padding:12px}",
      ".rlr_count{flex:none;min-width:18px;text-align:center;font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.06));color:var(--dsw-alias-label-secondary,#6e6e73);font-variant-numeric:tabular-nums}",

      /* ---- tables ---- */
      ".rlr_tableWrap{overflow-x:auto;border:1px solid var(--dsw-alias-border-l1,#e5e5ea);border-radius:10px;margin-top:8px}",
      ".rlr_table{width:100%;border-collapse:collapse}",
      ".rlr_table th,.rlr_table td{padding:7px 9px;text-align:left;vertical-align:middle}",
      ".rlr_table th{font-weight:600;color:var(--dsw-alias-label-secondary,#6e6e73);font-size:10px;text-transform:uppercase;letter-spacing:.05em;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));white-space:nowrap}",
      ".rlr_table td{border-top:1px solid var(--dsw-alias-border-l1,#efeff4)}",
      ".rlr_table tbody tr{transition:background .12s ease}",
      ".rlr_table tbody tr:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.025))}",
      ".rlr_table td.rlr_num{text-align:right;font-variant-numeric:tabular-nums}",
      ".rlr_table td.rlr_actions-cell{text-align:right;white-space:nowrap}",

      /* ---- actions ---- */
      ".rlr_actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}",
      ".rlr_spacer{flex:1 1 auto}",
      ".rlr_actionBar{position:sticky;bottom:0;z-index:3;display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:16px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,#e5e5ea);border-radius:12px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));backdrop-filter:blur(12px) saturate(180%);box-shadow:0 -1px 14px rgba(0,0,0,.08)}",
      ".rlr_btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d2d2d7);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1d1d1f);font:inherit;font-weight:500;cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease,transform .06s ease}",
      ".rlr_btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.04));border-color:var(--dsw-alias-brand-primary,#0a84ff)}",
      ".rlr_btn:active:not(:disabled){transform:translateY(1px)}",
      ".rlr_btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0a84ff);outline-offset:1px}",
      // The host's `--dsw-alias-brand-primary` token resolves to `neutral-bluish-50`
      // (near-white) in the light theme, so the affordance broke as white-on-white
      // until the fill stopped relying on the theme; !important also shields specs.
      ".rlr_btn[data-primary=true]{background:#2f6fdb !important;border-color:#2f6fdb !important;color:#fff !important}",
      ".rlr_btn[data-primary=true]:hover:not(:disabled){background:#2563cb !important;border-color:#2563cb !important;color:#fff !important}",
      ".rlr_btn[data-danger=true]{color:var(--dsw-alias-state-error-primary,#d70015);border-color:var(--dsw-alias-border-l2,#d2d2d7)}",
      ".rlr_btn[data-danger=true]:hover:not(:disabled){background:var(--dsw-alias-state-error-primary,#d70015);border-color:var(--dsw-alias-state-error-primary,#d70015);color:#fff}",
      ".rlr_btn[data-quiet=true]{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary,#6e6e73)}",
      ".rlr_btn[data-quiet=true]:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05));border-color:transparent;color:var(--dsw-alias-label-primary,#1d1d1f)}",
      // Declared last so it also beats the primary/danger fills. Opacity alone left
      // a disabled primary button as translucent white text over a pale blue fill,
      // which is why the save label was unreadable.
      ".rlr_btn:disabled{opacity:1;cursor:not-allowed;background:var(--dsw-alias-bg-layer-2,#f1f1f4);border-color:var(--dsw-alias-border-l1,#d5d5da);color:var(--dsw-alias-label-secondary,#8e8e93);filter:none;transform:none}",
      ".rlr_dirty{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:500;color:var(--dsw-alias-state-warn-primary,#b25000)}",
      ".rlr_dirty::before{content:\"\";width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary,#b25000)}",

      /* ---- notices ---- */
      ".rlr_note{display:flex;gap:8px;font-size:12px;padding:8px 10px;border-radius:9px;margin:0 0 8px;border:1px solid var(--dsw-alias-border-l1,#e5e5ea);background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03))}",
      ".rlr_note::before{content:\"\";flex:none;width:6px;height:6px;border-radius:50%;margin-top:5px;background:currentColor}",
      ".rlr_note[data-kind=ok]{color:var(--dsw-alias-state-success-primary,#1a7f37)}",
      ".rlr_note[data-kind=info]{color:var(--dsw-alias-brand-primary,#0a84ff)}",
      ".rlr_note[data-kind=warn]{color:var(--dsw-alias-state-warn-primary,#b25000)}",
      ".rlr_note[data-kind=error]{color:var(--dsw-alias-state-error-primary,#d70015)}",

      /* ---- detection ---- */
      ".rlr_provider{border:1px solid var(--dsw-alias-border-l1,#e5e5ea);border-radius:10px;padding:9px 10px;margin:0 0 8px;background:var(--dsw-alias-bg-layer-1,#fff)}",
      ".rlr_providerHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px}",
      ".rlr_providerName{font-weight:600;font-size:12px}",
      ".rlr_providerId{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--dsw-alias-label-secondary,#6e6e73);padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05))}",
      ".rlr_chips{display:flex;flex-wrap:wrap;gap:6px}",
      ".rlr_chip{font-size:11px;font-weight:500;padding:3px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#d2d2d7);background:var(--dsw-alias-bg-base,transparent);color:inherit;font:inherit;cursor:pointer;transition:border-color .15s ease,color .15s ease,background .15s ease}",
      ".rlr_chip:hover{border-color:var(--dsw-alias-brand-primary,#0a84ff);color:var(--dsw-alias-brand-primary,#0a84ff)}",
      ".rlr_chip[data-added=true]{border-color:var(--dsw-alias-state-success-primary,#1a7f37);color:var(--dsw-alias-state-success-primary,#1a7f37)}",
      ".rlr_chip[data-added=true]:hover{border-color:var(--dsw-alias-state-error-primary,#d70015);color:var(--dsw-alias-state-error-primary,#d70015)}",
      ".rlr_chipGroup{display:flex;align-items:center;gap:6px;margin:4px 0;flex-wrap:wrap}",
      ".rlr_chipGroupName{font-weight:600;min-width:110px}",
      ".rlr_empty{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#6e6e73);border:1px dashed var(--dsw-alias-border-l2,#d2d2d7);border-radius:10px;padding:12px;margin:0 0 8px}",
      ".rlr_metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px;margin:2px 0 12px}",
      ".rlr_metric{display:flex;flex-direction:column;gap:2px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1,#e5e5ea);border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03))}",
      ".rlr_metricValue{font-size:18px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.2}",
      ".rlr_metricValue[data-tone=error]{color:var(--dsw-alias-state-error-primary,#d70015)}",
      ".rlr_metricValue[data-tone=warn]{color:var(--dsw-alias-state-warn-primary,#b25000)}",
      ".rlr_metricValue[data-tone=ok]{color:var(--dsw-alias-state-success-primary,#1a7f37)}",
      ".rlr_metricLabel{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#6e6e73)}",

      /* ---- composer dock line ---- */
      ".rlr_statsDock{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary,#6e6e73);padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,#e5e5ea);background:var(--dsw-alias-bg-layer-1,#fff);font-variant-numeric:tabular-nums;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}",
      ".rlr_statsDock b{flex:none;font-weight:600;color:var(--dsw-alias-brand-primary,#0a84ff)}"
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
      // Number("") is 0, so an emptied box must fall back instead of silently
      // serializing as 0 (0 means "unlimited" for rpm and concurrency, and
      // "reject immediately" for maxWaitMs).
      if (value === "") return fallback;
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
        // The card offers one three-way choice; "off" is stored as
        // `enabled: false` (see serializeDraft), which is also how a
        // hand-edited config expresses it.
        scope: source.enabled === false || source.scope === "off" ? "off" : source.scope === "overrides" ? "overrides" : "all",
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
        enabled: draft.scope !== "off",
        scope: draft.scope === "overrides" ? "overrides" : "all",
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
        // A cleared box has to block Save rather than quietly save 0.
        if (value === "" || !Number.isFinite(Number(value)) || Number(value) < min) numbers.push(label);
      };
      check(t("defaultRpm"), draft.requestsPerMinute, 0);
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
      if (provider) return (provider.models || []).map((model) => model.id);
      // An empty provider means "every route", so every detected model is a
      // valid suggestion; a provider detection does not know advertises nothing.
      if (providerId !== "") return [];
      const all = new Set();
      for (const entry of detection.providers) for (const model of entry.models || []) all.add(model.id);
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

    /**
     * A checkbox row. checkInput() already renders the label inside a <label>,
     * so this must not wrap it in field() — that would print the label twice.
     */
    function checkField(label, hint, checked, onChange) {
      return h(
        "div",
        { className: "rlr_field" },
        checkInput(label, checked, onChange),
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

    /** Collapsible section card: icon + title + optional count pill. */
    function section(icon, title, count, body) {
      return h(
        "details",
        { className: "rlr_fold" },
        h(
          "summary",
          { "data-icon": icon },
          h("span", null, title),
          count === null || count === undefined ? null : h("span", { className: "rlr_count" }, String(count))
        ),
        h("div", { className: "rlr_foldBody" }, body)
      );
    }

    /** Big-number tile used by the live-stats section. */
    function metric(label, value, tone) {
      return h(
        "div",
        { className: "rlr_metric" },
        h("span", { className: "rlr_metricValue", "data-tone": tone || undefined }, value),
        h("span", { className: "rlr_metricLabel" }, label)
      );
    }

    function emptyState(text) {
      return h("div", { className: "rlr_empty" }, text);
    }

    function tableWrap(table) {
      return h("div", { className: "rlr_tableWrap" }, table);
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
        return h("div", { className: "rlr_card" }, h("div", { className: "rlr_state" }, h("div", { className: "rlr_hint" }, t("loading"))));
      }
      if (status === "error" || !draft) {
        return h(
          "div",
          { className: "rlr_card" },
          h(
            "div",
            { className: "rlr_head" },
            h("span", { className: "rlr_heading" }, h("span", { className: "rlr_title" }, t("title")))
          ),
          h(
            "div",
            { className: "rlr_state" },
            note("error", notice ? notice.text : t("unavailable")),
            h(
              "div",
              { className: "rlr_actions" },
              h("button", { className: "rlr_btn", type: "button", "data-primary": "true", onClick: () => void load() }, t("retry"))
            )
          )
        );
      }

      const issues = draftIssues(draft, t);
      const problemCount = issues.numbers.length + issues.identity.length;
      // Compare the drafts themselves, not the serialized sections:
      // serializeDraft() drops rows and rules whose provider/model/urlPattern is
      // still empty, so an add-row or add-rule click produced a byte-identical
      // payload and Save stayed disabled. Both sides always come out of
      // normalizeDraft(), so the key order is stable.
      const dirty = loaded !== null && JSON.stringify(draft) !== JSON.stringify(loaded);
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
          // load() clears the notice on its success path, so reload first and
          // set the warning afterwards — otherwise the user's edits are
          // replaced with no explanation at all.
          await load();
          setNotice({ kind: "warn", text: t("conflictStale") });
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
        field(
          t("scope"),
          t("scopeHint"),
          h(
            "select",
            {
              className: "rlr_select",
              value: draft.scope,
              onChange: (event) => edit({ scope: event.target.value })
            },
            h("option", { value: "all" }, t("scopeAll")),
            h("option", { value: "overrides" }, t("scopeOverrides")),
            h("option", { value: "off" }, t("scopeOff"))
          )
        ),
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
        checkField(t("upstream429Backoff"), t("upstream429BackoffHint"), draft.upstream429Backoff, (value) => edit({ upstream429Backoff: value })),
        field(t("backoffMs"), t("backoffMsHint"), numberInput(draft.backoffMs, (value) => edit({ backoffMs: value }))),
        field(t("maxBackoffMs"), t("maxBackoffMsHint"), numberInput(draft.maxBackoffMs, (value) => edit({ maxBackoffMs: value }))),
        field(t("backoffJitter"), t("backoffJitterHint"), numberInput(draft.backoffJitter, (value) => edit({ backoffJitter: value })))
      );

      /* ---- detection ---- */
      const addedRoutes = new Set(draft.models.map((row) => `${row.provider}\u0000${row.model}`));
      const isAdded = (providerId, modelId) => addedRoutes.has(`${providerId}\u0000${modelId}`);
      const detectedProviders = detection.providers || [];
      const detectedModelCount = detectedProviders.reduce((total, provider) => total + (provider.models || []).length, 0);
      const detectionSection = h(
        "div",
        null,
        h(
          "div",
          { className: "rlr_grid" },
          checkField(t("autoDetectModels"), t("autoDetectModelsHint"), draft.autoDetectModels, (value) => edit({ autoDetectModels: value })),
          field(t("detectIntervalMs"), t("detectIntervalMsHint"), numberInput(draft.detectIntervalMs, (value) => edit({ detectIntervalMs: value })))
        ),
        h(
          "div",
          { className: "rlr_metrics" },
          metric(t("detectedProviders"), String(providerIds.length), providerIds.length === 0 ? "warn" : "ok"),
          metric(t("detectedModels"), String(detectedModelCount))
        ),
        h(
          "div",
          { className: "rlr_actions" },
          h("button", { className: "rlr_btn", type: "button", disabled: detecting, onClick: () => void loadModels(true) }, t("refreshDetect")),
          h("button", { className: "rlr_btn", type: "button", disabled: providerIds.length === 0, onClick: addDetectedProviders }, t("addDetectedProviders")),
          h("button", { className: "rlr_btn", type: "button", disabled: providerIds.length === 0, onClick: addDetectedModels }, t("addDetectedModels")),
          h(
            "span",
            { className: "rlr_spacer" }
          ),
          h(
            "span",
            { className: "rlr_hint" },
            `${t("detectedAt")}: ${detection.detectedAt ? new Date(detection.detectedAt).toLocaleTimeString() : "—"}`
          )
        ),
        detectedProviders.length === 0 ? emptyState(t("detectEmpty")) : null,
        ...detectedProviders.map((provider) =>
          h(
            "div",
            { className: "rlr_provider", key: `d-${provider.id}` },
            h(
              "div",
              { className: "rlr_providerHead" },
              h("span", { className: "rlr_providerName" }, provider.name === provider.id ? provider.id : provider.name),
              provider.name === provider.id ? null : h("span", { className: "rlr_providerId" }, provider.id),
              h("span", { className: "rlr_count" }, String((provider.models || []).length))
            ),
            (provider.models || []).length === 0
              ? h("div", { className: "rlr_hint" }, t("noModels"))
              : h(
                  "div",
                  { className: "rlr_chips" },
                  ...(provider.models || []).map((model) => {
                    const added = isAdded(provider.id, model.id);
                    return h(
                      "button",
                      {
                        className: "rlr_chip",
                        type: "button",
                        key: `${provider.id}/${model.id}`,
                        "data-added": added ? "true" : "false",
                        title: added ? `${provider.id} / ${model.id} · ${t("alreadyAdded")}` : `${provider.id} / ${model.id}`,
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
                    );
                  })
                )
          )
        ),
        ...(detection.errors || []).map((error, index) =>
          h("div", { key: `err-${index}`, className: "rlr_note", "data-kind": "warn" }, `${error.where}: ${error.message}`)
        )
      );

      /* ---- per-route rows ---- */
      const rows = h(
        "div",
        null,
        h("div", { className: "rlr_hint" }, t("rowsHint")),
        tableWrap(
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
                      // Show the row's real provider even when detection no longer
                      // lists it; the trailing option below carries that value.
                      value: row.provider,
                      onChange: (event) => {
                        const provider = event.target.value;
                        // A native <datalist> filters its options by the text
                        // already in the box, so a model left over from the
                        // previous provider would hide the new provider's models.
                        const known = provider === "" || detectedModelIds(detection, provider).includes(row.model);
                        const keepModel = row.model.length > 0 && known;
                        editRow(index, keepModel ? { provider } : { provider, model: "" });
                      }
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
                  (() => {
                    const known = detectedModelIds(detection, row.provider);
                    return h(
                      "div",
                      { className: "rlr_pair" },
                      h("input", {
                        className: "rlr_input",
                        type: "text",
                        list: `rlr-models-${index}`,
                        value: row.model,
                        placeholder: t("allModels"),
                        onChange: (event) => editRow(index, { model: event.target.value })
                      }),
                      // A native <datalist> filters its options by the text already in
                      // the box, so once a model is picked the list collapses to that
                      // one entry and no other model can be selected. This dropdown
                      // always lists the provider's full set.
                      known.length > 0
                        ? h(
                            "select",
                            {
                              className: "rlr_select rlr_pick",
                              value: "",
                              title: t("browseModel"),
                              onChange: (event) => {
                                const model = event.target.value;
                                if (model) editRow(index, { model });
                              }
                            },
                            h("option", { value: "" }, `▾ ${t("browseModel")}`),
                            ...known.map((modelId) => h("option", { key: modelId, value: modelId }, modelId))
                          )
                        : null,
                      h(
                        "datalist",
                        { id: `rlr-models-${index}` },
                        ...known.map((modelId) => h("option", { key: modelId, value: modelId }))
                      )
                    );
                  })()
                ),
                h("td", null, numberInput(row.requestsPerMinute, (value) => editRow(index, { requestsPerMinute: value }))),
                h("td", null, numberInput(row.burst, (value) => editRow(index, { burst: value }))),
                h(
                  "td",
                  { className: "rlr_actions-cell" },
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
            { key: `rule-${index}`, className: "rlr_provider" },
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
              checkField(t("identityEnabled"), null, rule.enabled, (value) => editRule(index, { enabled: value })),
              checkField(t("identityDynamic"), null, rule.dynamicIds, (value) => editRule(index, { dynamicIds: value }))
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
              { className: "rlr_metrics" },
              metric(t("statsRoutes"), String(aggregate.routes)),
              metric(t("statsTotal"), String(aggregate.reserved)),
              metric(t("statsRejected"), String(aggregate.rejected), aggregate.rejected > 0 ? "error" : undefined),
              metric(t("statsWaited"), String(aggregate.waited), aggregate.waited > 0 ? "warn" : undefined),
              metric(t("statsAvgWait"), `${Math.round(Number(aggregate.avgWaitMs) || 0)} ms`),
              metric(t("statsQueued"), String(aggregate.queuedNow), aggregate.queuedNow > 0 ? "warn" : undefined),
              metric(t("statsCooling"), String(aggregate.coolingRoutes), aggregate.coolingRoutes > 0 ? "error" : undefined)
            ),
        aggregate && stats.routes.length > 0
          ? tableWrap(
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
            )
          : null,
        aggregate && stats.routes.length === 0 ? emptyState(t("dockNoData")) : null,
        h(
          "div",
          { className: "rlr_actions" },
          h(
            "button",
            {
              className: "rlr_btn",
              type: "button",
              onClick: async () => {
                const result = await bridgeCall("/stats-reset", {});
                void pollStats();
                setNotice(
                  result && result.ok
                    ? { kind: "ok", text: t("statsResetDone") }
                    : { kind: "error", text: (result && result.message) || t("failed") }
                );
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
        draft.scope === "off" ? note("warn", t("scopeOffNote")) : null,
        draft.scope === "overrides" ? note("info", t("scopeOverridesNote")) : null,
        basicGrid,
        section("◎", t("detectTitle"), providerIds.length, detectionSection),
        section("≡", t("rowsTitle"), draft.models.length, rows),
        section("✎", t("identityTitle"), draft.identityRules.length, identity),
        section("∿", t("statsTitle"), null, statsSection),
        h(
          "div",
          { className: "rlr_actionBar" },
          h(
            "button",
            { className: "rlr_btn", type: "button", "data-quiet": "true", disabled: !dirty || saving, onClick: () => setDraft(normalizeDraft(loaded)) },
            t("discard")
          ),
          h("button", { className: "rlr_btn", type: "button", disabled: saving, "data-danger": "true", onClick: () => void resetAll() }, t("resetAll")),
          h("span", { className: "rlr_spacer" }),
          dirty ? h("span", { className: "rlr_dirty" }, t("dirty")) : null,
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
          )
        )
      );

      const limited = draft.scope !== "off";
      const scopeBadge =
        draft.scope === "overrides" ? t("scopeOverrides") : draft.scope === "off" ? t("scopeOff") : t("scopeAll");

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
          h(
            "span",
            { className: "rlr_heading" },
            h("span", { className: "rlr_title" }, t("title")),
            h(
              "span",
              { className: "rlr_sub" },
              limited ? `${draft.requestsPerMinute}/min · ${draft.burst} ${t("burst")}` : t("stateOff")
            )
          ),
          h(
            "span",
            { className: "rlr_badges" },
            h(
              "span",
              { className: "rlr_badge", "data-on": limited ? "true" : "false" },
              h("span", { className: "rlr_dot" }),
              limited ? t("stateOn") : t("stateOff")
            ),
            h("span", { className: "rlr_badge", "data-scope": draft.scope }, scopeBadge),
            h("span", { className: "rlr_badge" }, draft.mode === "reject" ? t("modeReject") : t("modeWait")),
            h("span", { className: "rlr_badge" }, `${draft.requestsPerMinute}/min`, " · ", `${draft.burst}`)
          )
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
      const scopeNote = stats.config && stats.config.scope === "overrides" ? t("scopeOverridesNote") : "";
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
          title: [scopeNote, detail].filter(Boolean).join("\n") || t("dockNoData")
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
