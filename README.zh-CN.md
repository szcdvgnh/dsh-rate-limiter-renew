# dsh-rate-limiter-renew

針對 **DeepSeek Harness 0.2.x** 的**按供應商 + 模型**粒度限速插件。

本插件是 [`dsh-provider-rate-limit`](https://github.com/jyao-SUSE-power-group/dsh-provider-rate-limit)
（0.3.1）的現代化續作。**舊版的所有功能都保留**；被 0.2.x 框架移除或改寫的
部分全部重寫；並新增一項關鍵能力：**限速器會自動偵測你實際擁有的模型，不再依賴
手寫的靜態路由表。**

```
LLM 呼叫 ──▶ llm/stream 攔截器
              ├─ 總開關關閉？ ──────────────────────▶ 直接放行
              ├─ 解析 (provider, model) ─▶ 令牌桶
              │    ├─ wait 模式：等待後繼續
              │    └─ reject 模式（或等待超過 maxWaitMs）：finish{ RATE_LIMIT }
              ├─ 併發閘門（可選，嚴格 FIFO）
              └─ adapter 串流
                   └─ finish.error.status === 429 ─▶ 該路由冷卻
                                                     （且仍然照常轉發）
```

---

## 1. 為什麼要重寫

| 舊版設計 | 0.2.x 的狀態 | 本插件的做法 |
| --- | --- | --- |
| 模組層級匯出 `installSettingsSection()` | **已移除**，import 它會在載入時崩潰 | 移除；設定改由 profile 擁有的 `Config` 承載 |
| `SettingsProvider#installSection` / `register(ns, schema)` | **已移除** | 使用 host 的 `settings` 服務 + 插件自帶的設定卡片 |
| 設定頁 slot `settings.plugin.item` | **已於 rc.1 廢棄** | `plugins.row.config` keyed slot（`dsh-rate-limiter-renew#rate-limiter-renew`） |
| `ctx.reflect?.provide(name, service)` | 已被取代 | `ctx.provide(name, service)` |
| `dsh-client-store` 的 `createSnapshotStore(lazyGetter)` | 不再接受 lazy getter；`subscribe` 變成 notify-only | 自製 20 行 observable store |
| `scripts/patch-host-allowlist.mjs`（改寫 host 的 web-settings 白名單） | 不再需要 | bridge 直接呼叫行程內的 `settings` 服務 |
| 路由表只能用手打 | 看不到使用者自訂的供應商 | 直接向 `llm` 服務讀取即時目錄 |

功能清單一項都沒少：令牌桶、wait/reject 兩種模式、嚴格 FIFO 預約、上游 429
退避、per-route 覆寫、閘道身份改寫、總開關、統計 UI、SSE 推送、HTTP 統計端點、
跨插件統計服務，全部保留。

---

## 2. 環境需求

* **DeepSeek Harness `0.2.0-rc.0` 或更新**（已驗證 `0.2.0-rc.2`、`0.2.0`；
  `dsh.engines.dsh` 為 `>=0.2.0-0`——結尾的 `-0` 是關鍵，因為 node-semver
  只有在 comparator 本身帶 prerelease 時才接受 prerelease 版本）。
* Node.js 22.8+（只有跑測試需要；host 執行期自帶更新的版本）。
* web 平台的 profile（`dsh.client.platform = "web"`）才能看到設定卡片與
  composer 統計行；host 半邊在無介面環境仍可運作。

---

## 3. 安裝

### 3.1 作為 profile 依賴（建議）

```powershell
# 1) 把套件放進 profile
cd "$env:USERPROFILE\.dsh\profiles\desktop"
npm install "file:C:\path\to\dsh-rate-limiter-renew"
#    或 tarball / git URL / registry，視你的發佈方式而定
```

```yaml
# 2) $env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml
- insert:
    - id: rate-limiter-renew
      name: dsh-rate-limiter-renew
      inject: [llm]
      config:
        enabled: true
```

```jsonc
// 3) 若也想放進 bundle 清單
//    $env:USERPROFILE\.dsh\profiles\desktop\package.json
"dsh": { "profile": { "bundles": [ … , "dsh-rate-limiter-renew" ] } }
```

之後**重新啟動 DSH**（profile 的組合是在啟動時讀取的）。

> `cordis.patch.yml` 裡的 `id` **同時**是設定命名空間，**也是** UI 行 key 的
> 後半段（`dsh-rate-limiter-renew#rate-limiter-renew`）。除非你同時改
> `lib/index.js` 的 `NS` 與 `lib/client.js` 的 `ROW_KEY`，否則請保持
> `rate-limiter-renew` 不變。

### 3.2 直接複製安裝

把目錄放到 `<profile>\node_modules\dsh-rate-limiter-renew\`，並加上同樣的 patch
entry 即可。唯一的執行期依賴是 `@deepseek-ai/schemastery`（每個 0.2.x profile
都有），其餘 `@deepseek-ai/*` import 由 DSH 載入器自行解析——這也是本套件
**刻意不宣告 `peerDependencies`** 的原因：peer range 只會多一個解析失敗的機會，
而沒有換到任何好處。

**不需要建置**：`lib/index.js` 是純 ESM，`lib/client.js` 是靜態
`window.__ModuleLoader__.load({...})` bundle，兩者都不需要打包工具。

### 3.3 從 GitHub 安裝

倉庫：<https://github.com/szcdvgnh/dsh-rate-limiter-renew>

```powershell
# CLI 管理的 profile（例如 web）。desktop profile 由 Electron App 獨佔，CLI 進不去。
dsh plugin --profile web add "github:szcdvgnh/dsh-rate-limiter-renew"

# 可重現的安裝：固定 commit（pnpm 對 github: 是抓 codeload tarball，不是 git clone）
dsh plugin --profile web add "github:szcdvgnh/dsh-rate-limiter-renew#<commit-sha>"
```

在 **App 內建市集**裡安裝有兩個前提：市集只安裝
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
精選清單內的來源，且來源優先序是「經倉庫驗證的 npm 包 → GitHub Release 預打包
tarball → 整倉原始碼」。想讓市集一鍵安裝，請在精選清單提一條 PR（通常一天內
收錄），並把 `pnpm pack` 產生的 `dsh-rate-limiter-renew-1.0.0.tgz` 附在 `v1.0.0`
Release 上——預打包路線幾秒裝完，且不會執行任何建置腳本（本套件也沒有建置腳本）。

> 靠 `github:` 安裝時，market / CLI 只負責「裝」；**啟用**要靠 `dsh.bundle.patch`
> 被寫進 `dsh.profile.bundles`，或你手工加上 3.1 的 patch entry。

---

## 4. 設定

所有欄位都可以在插件頁即時編輯（側欄 → 插件 → 已安裝 → dsh-rate-limiter-renew
→ 行配置）。每個欄位都宣告為 `.volatile()`，因此 host 會傳給插件一個 live
參考，編輯後不需重啟即生效。

| 鍵 | 型別 | 預設 | 說明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 總開關。**每個請求**都會檢查，切換後立即生效（不需重新註冊 listener）。 |
| `scope` | `"all"` \| `"overrides"` | `"all"` | 限速要套用到哪些路由——見 §4.1。「全部關」是 `enabled: false`，不是第三種 scope。 |
| `requestsPerMinute` | number | `20` | 預設路由的補充速率。**`0` 代表無限制**——這是明確的哨兵值，不是「未設定」。 |
| `burst` | number | `4` | 桶容量。`1` 表示不允許突發。 |
| `mode` | `"wait"` \| `"reject"` | `"wait"` | 預約會阻塞時的行為。無法辨識的字串會回退為 `wait`。 |
| `maxWaitMs` | number | `30000` | `wait` 模式下，預估等待超過此值就改為拒絕。`0` 表示只要需要等待就拒絕。 |
| `upstream429Backoff` | boolean | `true` | adapter 回傳 HTTP 429 時讓該路由冷卻。 |
| `backoffMs` | number | `30000` | 第一次冷卻時間。 |
| `maxBackoffMs` | number | `60000` | 冷卻倍增的上限。 |
| `backoffJitter` | number | `0` | `0..1` 的對稱抖動。 |
| `maxConcurrentRequests` | number | `0` | 每路由同時進行中的上限。`0` 表示不限；> 0 時為嚴格 FIFO。 |
| `autoDetectModels` | boolean | `true` | 是否向 `llm` 服務偵測**你已經加入的**供應商／模型。 |
| `detectIntervalMs` | number | `60000` | 偵測結果的 TTL／更新間隔（> 0 時下限為 5000；`0` 表示停用定時器）。 |
| `models` | array | `[]` | 每路由覆寫，見下。 |
| `identityRules` | array | `[]` | 閘道身份改寫，見下。 |

### 4.1 限速範圍（`scope`）

頁面上是一個三選一的選單；寫進設定檔時仍然是兩個欄位，因為「全部關」就是總開關本身：

| 頁面選項 | JSON | 效果 |
| --- | --- | --- |
| 全部都開（所有路由） | `scope: "all"`, `enabled: true` | 每個（供應商, 模型）都限速：有命中 `models` 列就用那一列，否則用全域 `requestsPerMinute`/`burst`。 |
| 只為路由覆寫開 | `scope: "overrides"`, `enabled: true` | 只有命中 `models` 列的（供應商, 模型）才限速。沒有對應覆寫列的路由直接放行——不進桶、不排隊、不做 429 冷卻，也不會出現在統計裡。 |
| 全部關 | `enabled: false` | 完全不限速，卡片與輸入框下方的狀態列都會標示。 |

這個選擇是**每個請求**重新讀取的，所以切換後下一個請求就生效、不必重啟；剛離開範圍的路由桶會在下一次統計快照時移除。

### 4.2 每路由覆寫（`models`）

```yaml
models:
  - provider: nvidia                 # 精確或子串比對
    model: deepseek-v4.1-flash       # 留空 = 該供應商的所有模型
    requestsPerMinute: 10
    burst: 2
  - provider: openrouter
    requestsPerMinute: 0             # 僅此供應商無限制
```

比對採單一評分流程，最具體者勝：

* `provider` 與 `model` 都精確命中 —— 直接回傳；
* 其餘 `score = (provider 精確 ? 4 : provider 子串 ? 2 : 0)
  + (model 精確 ? 8 : model 子串 ? 4 : 0)`，取最高分；
* `provider`+`model` 皆空的列是全域列，只在沒有更窄規則命中時生效。

因此：精確 > 子串、模型 pattern > 供應商全域、具體 > 全域；若某列的
`provider` 命中但 `model` pattern 不命中，該列會被整條跳過（不會退化成次級命中）。

### 4.3 閘道身份改寫（`identityRules`）

某些閘道（尤其 OpenCode Zen）會對客戶端做指紋辨識。規則會在請求離開行程前
改寫它：

```yaml
identityRules:
  - urlPattern: opencode.ai/zen      # 對請求 URL 做子串比對
    enabled: true
    userAgent: "opencode/1.18.25 ai-sdk/provider-utils/4.0.38 runtime/bun/1.3.14"
    dynamicIds: true                 # 注入 x-opencode-client/project/session/request
    headers:
      - name: x-custom
        value: "1"
```

* `dynamicIds: true` 會注入 `x-opencode-client: cli`、`x-opencode-project: global`、
  `x-opencode-session: ses_<ULID>`（在插件實例生命週期內固定）與
  `x-opencode-request: msg_<ULID>`（每個請求不同）。
* 靜態 `headers` **最後**套用，因此可覆寫上面任何標頭。
* `enabled: false` 或 `urlPattern` 為空 → 該規則略過；沒有任何生效規則時，
  wrapper 是純直通。
* `globalThis.fetch` 以 `Symbol.for(...)` 為 key 做 ref-count patch，dispose 時
  精確還原為原生函式（且只在它仍屬於我們時才還原）。

設定卡片提供一鍵「套用 OpenCode Zen 預設」。

---

## 5. 自動偵測模型

舊插件看不到任何使用者沒有手打的東西，因為它只走靜態路由表。本插件向 host
詢問**已經加入**的路由，因此偵測（以及連帶的覆寫列）只會出現 profile 真正
擁有的供應商與模型：

1. `llm.listProviders()` —— 具有**已註冊 adapter** 的供應商，也就是 profile
   已經加入的路由；
2. 對每一個這種供應商呼叫 `llm.listModels(provider)` —— 該供應商回報的模型，
   也就是你模型清單裡實際存在的 model id。

結果會合併為每個供應商的 `{ id, name, sources[], models[] }`（`sources` 為
`adapter` 與／或 `listModels`），以 `detectIntervalMs` 為 TTL 快取，並由
`llm/adapters-updated` 事件失效（adapter 註冊會改變「已加入」集合）。設定
卡片為每個偵測到的供應商顯示一張卡片，每個模型是一個 chip：點擊 chip 會新增
一列覆寫；**加入所有供應商（整條路由）** 與 **加入所有模型（逐模型）** 可批次
填入表格。覆寫列的 provider 欄位是偵測結果的 `<select>`（另有「所有」與列上
既有的值）。

另外兩個相鄰介面刻意**不**讀取：`llm.listConfigurableProviders()`（profile
宣告的供應商目錄，包含沒有作用中 adapter 的休眠供應商）與
`llm.discoverModels()`（對草稿端點探測、回傳尚未被採用的候選模型）。兩者
描述的都是你**還沒加入**的東西，正是這個面板不該提供的內容。若要限制尚未
列出的路由，請直接在覆寫列手動輸入（模型欄位是自由文字），或先到 host 的
「模型」設定頁加入，下次偵測就會帶進來。

偵測永不拋錯：某個供應商失敗會連同錯誤一起出現在快照中，其餘目錄照常可用。

---

## 6. 統計

| 介面 | 取得方式 |
| --- | --- |
| 設定卡片 | 即時計數 + 每路由表格，經 SSE 推播 |
| Composer 行 | composer dock 內顯示 `⏱ 20/min ×4 · 12 total · 3 waited · 0 rejected · 1 queued · 2 routes`，hover 顯示每路由明細 |
| HTTP | `POST /api/dsh-rate-limiter-renew/stats` |
| SSE | `GET /api/dsh-rate-limiter-renew/events`（`event: snapshot`、15 秒心跳、連線即送快照） |
| 跨插件 | 服務 `rate-limiter-renew/stats` → `getStats(provider, model)`、`getAllStats()`、`getAggregateStats()`、`resetStats()`、`detectModels({force})`、`getDetectedModels()` |

```js
const stats = ctx.get("rate-limiter-renew/stats");
stats.getAggregateStats();
// { total, waited, rejected, queued, reserved, totalWaitMs, activeCount, routes }
```

每路由計數：`reserved`、`waited`、`totalWaitMs`、`rejected`、`queued`、
`activeCount`、`unlimited`、`coolUntil`、`consecutiveFails`。

### Bridge 端點

所有 bridge 路由皆為 `POST` + JSON，且**僅限 loopback**（同時檢查來源位址、
`Host` 標頭與 `Origin`/`Sec-Fetch-Site`），body 上限 64 KiB：

`/describe` · `/replace` · `/mutate` · `/reset` · `/models` · `/stats` ·
`/stats-reset` · `GET /events`

它們直接呼叫行程內的 `settings` 服務，因此**不需要再 patch 任何白名單**，也不會
出現 `settings-not-exposed` —— 只要 patch row 存在，命名空間就是可見的。

---

## 7. 告警與互通

* **拒絕是一等的 LLM failure。** 被拒絕的呼叫會以
  `{ type: "finish", reason: { kind: "error", failure: { code: "RATE_LIMIT",
  status: 429, providerRetryAfterMs } } }` 結束，下游的 retry 插件看到的是正常的
  可重試 429，而不是不明錯誤。
* **上游 429 仍會送到 `dsh-llm-retry`。** 本插件只讓本機路由冷卻，原始 finish
  原封不動轉發。
* **支援 abort。** 排隊或等待中被呼叫方 abort 的請求，會以
  `reason.kind === "aborted"` 結束並離開 FIFO 佇列。

---

## 8. 開發與測試

```bash
npm test          # 51 個測試：24 核心 + 22 host + 5 client
npm run check     # 對三個進入點做 node --check
```

測試完全離線。`test/harness/register.mjs` 會安裝 ESM resolve hook，把
`@deepseek-ai/dsh-settings` 與 `@deepseek-ai/schemastery`（它們在 DSH **內部**，
不在 npm 上）映射到約 80 行的 stub，因此 `lib/index.js` 是**真的被載入**，再由
假的 Cordis `ctx` 驅動——包含會檢查重複路由的假 `webServer`，以及能拋
`SettingsConflictError` 的假 `settings` 服務。

`test/client.test.mjs` 透過假的 `window.__ModuleLoader__` 與最小 React stub 載入
真正的 `lib/client.js`，並斷言 `apply()` 以正確的 key 掛上兩個 slot——這個靜態
bundle 否則不會被任何工具鏈檢查。

```
test/
  core.test.mjs           令牌桶、ULID、限額解析、退避、合併、diff
  host.test.mjs           攔截、模式、併發、身份 patch、bridge
  client.test.mjs         bundle 載入、匯出、slot 註冊
  harness/register.mjs    --import 入口
  harness/hooks.mjs       ESM resolve hook（stub 映射）
  harness/stub-*.mjs      schemastery 與 SettingsConflictError stub
```

> 在 Windows 沙箱化的 shell 中，`node --test test/` 會以
> `Error: spawn EPERM` 失敗（測試執行器要為每個檔案 spawn 子程序，而 piped
> stdio 被禁止），而 `--test-isolation=none test/` 會遇到
> `ERR_UNSUPPORTED_DIR_IMPORT`。**明確列出檔案**（也就是 `test` script 的做法）
> 在任何環境都能運作。

---

## 9. 已知限制

1. **上游只辨識 HTTP 429。** 其他故障型態（JSON body 內寫額度不足、402、503）
   不會被視為限速。
2. **偵測是盡力而為。** 它只能回報 `llm` 服務願意揭露的內容。若某供應商的
   adapter 拒絕 `listModels` 且沒有目錄 entry，就無法被偵測到，請手動加入。
3. **桶狀態在記憶體中、且以行程為單位。** 重載 profile 會重置計數與冷卻
   （刻意如此——持久化令牌只會更糟）。
4. **身份 patch 是行程級的全域 patch。** host 行程中任何 `fetch` 都會受影響，
   不限於 LLM 流量；規則以 URL 為範圍，且 dispose 時會還原，但若有其他插件同時
   patch `fetch`，兩者可能互相交錯。
5. **`x-opencode-session` 以插件實例為單位固定**，不是每次對話。舊版是每個請求
   重新產生 session id——而閘道正是靠它做指紋辨識，所以這是刻意改掉的。
6. **前端是靜態 `web` bundle。** 沒有 React/JSX 工具鏈，因此卡片以
   `createElement` 撰寫。其他平台（CLI/TUI）仍可運作 host 半邊，但沒有卡片與
   composer 行。
7. **沒有 `peerDependencies`。** 這是刻意的（見 §3.2），代價是若把本插件裝在
   不相容的 DSH 旁邊，npm 不會發出警告。

---

## 10. 授權

MIT，詳見 [LICENSE](./LICENSE)。本插件為 `dsh-provider-rate-limit`（MIT）的
續作，沿用其架構與功能集。
