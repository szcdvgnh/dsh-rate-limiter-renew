/**
 * Renders docs/preview.html — a static, dependency-free mock of the settings
 * card so the styling can be reviewed in any browser without installing the
 * plugin into a DSH profile.
 *
 * The stylesheet is extracted from the real `lib/client.js` (never copied), so
 * the preview always shows the shipped CSS. The markup below mirrors what
 * `RateLimiterCard` renders; it is a mock, not the component itself.
 *
 * Run: node docs/preview.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const clientPath = new URL("../lib/client.js", import.meta.url);
const source = readFileSync(clientPath, "utf8");

const start = source.indexOf("const css = [");
if (start === -1) throw new Error("lib/client.js: the `const css = [` block was not found");
const open = start + "const css = ".length;
const close = source.indexOf('].join("");', open);
if (close === -1) throw new Error("lib/client.js: the `].join(\"\");` terminator was not found");
const literal = source.slice(open, close + 1);
/* eslint-disable-next-line no-new-func -- the array literal is our own source. */
const css = Function(`"use strict";return (${literal});`)().join("");

const tokens = {
  light: {
    "--dsw-alias-bg-base": "#ffffff",
    "--dsw-alias-bg-layer-1": "#ffffff",
    "--dsw-alias-bg-layer-2": "#f2f2f7",
    "--dsw-alias-bg-overlay": "rgba(255,255,255,.92)",
    "--dsw-alias-border-l1": "#e5e5ea",
    "--dsw-alias-border-l2": "#d2d2d7",
    "--dsw-alias-brand-primary": "#0a84ff",
    "--dsw-alias-label-primary": "#1d1d1f",
    "--dsw-alias-label-secondary": "#6e6e73",
    "--dsw-alias-state-error-primary": "#d70015",
    "--dsw-alias-state-idle-primary": "#8e8e93",
    "--dsw-alias-state-success-primary": "#1a7f37",
    "--dsw-alias-state-warn-primary": "#b25000"
  },
  dark: {
    "--dsw-alias-bg-base": "#000000",
    "--dsw-alias-bg-layer-1": "#1c1c1e",
    "--dsw-alias-bg-layer-2": "#2c2c2e",
    "--dsw-alias-bg-overlay": "rgba(28,28,30,.86)",
    "--dsw-alias-border-l1": "#38383a",
    "--dsw-alias-border-l2": "#48484a",
    "--dsw-alias-brand-primary": "#0a84ff",
    "--dsw-alias-label-primary": "#f2f2f7",
    "--dsw-alias-label-secondary": "#aeaeb2",
    "--dsw-alias-state-error-primary": "#ff453a",
    "--dsw-alias-state-idle-primary": "#8e8e93",
    "--dsw-alias-state-success-primary": "#30d158",
    "--dsw-alias-state-warn-primary": "#ff9f0a"
  }
};

const vars = (theme) =>
  Object.entries(tokens[theme])
    .map(([name, value]) => `      ${name}: ${value};`)
    .join("\n");

function provider(name, id, models) {
  const chips = models
    .map((model) => {
      const added = model.added ? ' data-added="true" title="' + id + " / " + model.id + ' · already added"' : ` title="${id} / ${model.id}"`;
      return `            <button class="rlr_chip" type="button"${added}>${model.id}</button>`;
    })
    .join("\n");
  return `        <div class="rlr_provider">
          <div class="rlr_providerHead">
            <span class="rlr_providerName">${name}</span>
            ${name === id ? "" : `<span class="rlr_providerId">${id}</span>`}
            <span class="rlr_count">${models.length}</span>
          </div>
          <div class="rlr_chips">
${chips}
          </div>
        </div>`;
}

const metric = (label, value, tone) =>
  `          <div class="rlr_metric"><span class="rlr_metricValue"${tone ? ` data-tone="${tone}"` : ""}>${value}</span><span class="rlr_metricLabel">${label}</span></div>`;

const html = `<!doctype html>
<html lang="zh-Hant" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>dsh-rate-limiter-renew — settings card preview</title>
    <style>
      /* Mock of the DSH theme layer: only these tokens are read by the card. */
      html[data-theme="light"] {
${vars("light")}
      }
      html[data-theme="dark"] {
${vars("dark")}
      }
      html,
      body {
        margin: 0;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: 13px/1.5 -apple-system, "Segoe UI", "Noto Sans TC", sans-serif;
      }
      body {
        padding: 28px;
        display: flex;
        flex-direction: column;
        gap: 18px;
        max-width: 980px;
        margin: 0 auto;
      }
      .previewBar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
      }
      .previewBar button {
        font: inherit;
        padding: 5px 12px;
        border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-layer-1);
        color: inherit;
        cursor: pointer;
      }
      .previewNote {
        border: 1px dashed var(--dsw-alias-border-l2);
        border-radius: 10px;
        padding: 10px 12px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
      }
      /* ---- shipped stylesheet (extracted from lib/client.js) ---- */
${css}
    </style>
  </head>
  <body>
    <div class="previewBar">
      <strong style="color: var(--dsw-alias-label-primary)">Settings card preview</strong>
      <button id="toggle" type="button">切換深色 / toggle theme</button>
      <span>靜態 mock，樣式直接取自 <code>lib/client.js</code> 的 <code>css</code> 陣列。</span>
    </div>

    <div class="previewNote">
      This page exists only to eyeball the styling; the real card is mounted by the
      Host in the plugins row slot. Regenerate with <code>node docs/preview.mjs</code>.
    </div>

    <div class="rlr_card rlr_page">
      <div class="rlr_head">
        <span class="rlr_caret" data-open="true">▶</span>
        <span class="rlr_heading">
          <span class="rlr_title">路由限速（Renew）</span>
          <span class="rlr_sub">20/min · 4 突發</span>
        </span>
        <span class="rlr_badges">
          <span class="rlr_badge" data-on="true"><span class="rlr_dot"></span>開</span>
          <span class="rlr_badge" data-scope="overrides">只為路由覆寫開</span>
          <span class="rlr_badge">等待（排隊）</span>
          <span class="rlr_badge">20/min · 4</span>
        </span>
      </div>

      <div class="rlr_desc">針對每個（供應商、模型）限速：預約式令牌桶、FIFO 排隊、429 退避與身份改寫。</div>

      <div class="rlr_body">
        <div class="rlr_note" data-kind="ok">已儲存</div>
        <div class="rlr_note" data-kind="warn">目前設定不可寫入。</div>
        <div class="rlr_note" data-kind="info">只有符合覆寫列的路由會受限速；其他路由直接放行。</div>

        <div class="rlr_groups">
          <div class="rlr_group">
            <div class="rlr_groupTitle">基本設定</div>
            <div class="rlr_grid">
              <div class="rlr_field">
                <span class="rlr_label">限速範圍</span>
                <select class="rlr_select">
                  <option>全部都開（所有路由）</option>
                  <option selected>只為路由覆寫開</option>
                  <option>全部關</option>
                </select>
                <span class="rlr_hint">決定哪些路由會被限速。「只為路由覆寫開」時，沒有對應覆寫列的路由完全不受影響。</span>
              </div>
              <div class="rlr_field">
                <span class="rlr_label">預設 RPM</span>
                <input class="rlr_input" type="number" value="20" />
                <span class="rlr_hint">每個（供應商, 模型）的每分鐘上限；0 = 不限制。</span>
              </div>
              <div class="rlr_field">
                <span class="rlr_label">突發額度</span>
                <input class="rlr_input" type="number" value="4" />
                <span class="rlr_hint">空閒後可立即發出的最大請求數。</span>
              </div>
            </div>
          </div>
          <div class="rlr_group">
            <div class="rlr_groupTitle">排隊與併發</div>
            <div class="rlr_grid">
              <div class="rlr_field">
                <span class="rlr_label">空桶行為</span>
                <select class="rlr_select">
                  <option>等待（排隊）</option>
                  <option>拒絕（回傳 429）</option>
                </select>
              </div>
              <div class="rlr_field">
                <span class="rlr_label">最大等待（毫秒）</span>
                <input class="rlr_input" type="number" value="30000" />
                <span class="rlr_hint">等待模式下的排隊上限；超過就改為拒絕。</span>
              </div>
              <div class="rlr_field">
                <span class="rlr_label">最大併發</span>
                <input class="rlr_input" type="number" value="0" />
                <span class="rlr_hint">0 = 不限制；大於 0 時以 FIFO 分配併發槽位。</span>
              </div>
            </div>
          </div>
          <div class="rlr_group">
            <div class="rlr_groupTitle">退避設定</div>
            <div class="rlr_grid">
              <div class="rlr_field">
                <label class="rlr_check"><input type="checkbox" checked /> <span>上游 429 退避</span></label>
                <span class="rlr_hint">收到 429 時冷卻該路由，連續失敗指數加倍。</span>
              </div>
              <div class="rlr_field">
                <span class="rlr_label">退避基準（毫秒）</span>
                <input class="rlr_input" type="number" value="30000" />
                <span class="rlr_hint">沒有 Retry-After 時使用的初始冷卻時間。</span>
              </div>
              <div class="rlr_field">
                <span class="rlr_label">退避上限（毫秒）</span>
                <input class="rlr_input" type="number" value="60000" />
                <span class="rlr_hint">指數退避的天花板。</span>
              </div>
              <div class="rlr_field">
                <span class="rlr_label">退避抖動（0-1）</span>
                <input class="rlr_input" type="number" value="0" />
                <span class="rlr_hint">對退避時間加入對稱隨機抖動。</span>
              </div>
            </div>
          </div>
        </div>

        <details class="rlr_fold" open>
          <summary data-icon="◎"><span>已加入的供應商與模型</span><span class="rlr_count">2</span></summary>
          <div class="rlr_foldBody">
            <div class="rlr_grid">
              <div class="rlr_field">
                <label class="rlr_check"><input type="checkbox" checked /> <span>自動偵測我的模型</span></label>
                <span class="rlr_hint">只讀取你在「模型」設定頁已加入的 provider 與 model（listProviders + listModels）；尚未加入的目錄項目與候選模型不會列出。</span>
              </div>
              <div class="rlr_field">
                <span class="rlr_label">偵測間隔（毫秒）</span>
                <input class="rlr_input" type="number" value="60000" />
                <span class="rlr_hint">0 = 只在開啟頁面或 provider 拓撲變動時偵測。</span>
              </div>
            </div>

            <div class="rlr_metrics">
${metric("偵測到的供應商", "2", "ok")}
${metric("偵測到的模型", "4")}
            </div>

            <div class="rlr_actions">
              <button class="rlr_btn" type="button">重新偵測</button>
              <button class="rlr_btn" type="button">加入所有供應商（整條路由）</button>
              <button class="rlr_btn" type="button">加入所有模型（逐模型）</button>
              <span class="rlr_spacer"></span>
              <span class="rlr_hint">偵測時間: 下午3:42:11</span>
            </div>

${provider("NVIDIA", "nvidia", [
    { id: "deepseek-v4.1-flash", added: true },
    { id: "glm-4.6" },
    { id: "kimi-k2" }
  ])}
${provider("OpenRouter", "openrouter", [])}
            <div class="rlr_empty">尚未偵測到已加入的供應商；請先在「模型」設定頁加入 provider 與 model。</div>
          </div>
        </details>

        <details class="rlr_fold">
          <summary data-icon="≡"><span>每路由覆寫</span><span class="rlr_count">2</span></summary>
          <div class="rlr_foldBody">
            <div class="rlr_hint">provider / model 留空代表「全部」；先精確比對，再退回子串比對。</div>
            <div class="rlr_tableWrap">
              <table class="rlr_table">
                <thead>
                  <tr><th>供應商</th><th>模型</th><th>RPM</th><th>突發</th><th></th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td><select class="rlr_select"><option>nvidia</option></select></td>
                    <td>
                      <select class="rlr_select" data-col="model" title="選擇模型…">
                        <option>（全部）</option>
                        <option selected>deepseek-v4.1-flash</option>
                        <option>glm-4.6</option>
                      </select>
                    </td>
                    <td><input class="rlr_input" type="number" value="60" /></td>
                    <td><input class="rlr_input" type="number" value="2" /></td>
                    <td class="rlr_actions-cell"><button class="rlr_btn" type="button" data-danger="true">移除</button></td>
                  </tr>
                  <tr>
                    <td><select class="rlr_select"><option>（全部）</option></select></td>
                    <td>
                      <select class="rlr_select" data-col="model" title="選擇模型…">
                        <option selected>（全部）</option>
                        <option>deepseek-v4.1-flash</option>
                        <option>glm-4.6</option>
                        <option>llama-3.3-70b</option>
                      </select>
                    </td>
                    <td><input class="rlr_input" type="number" value="20" /></td>
                    <td><input class="rlr_input" type="number" value="4" /></td>
                    <td class="rlr_actions-cell"><button class="rlr_btn" type="button" data-danger="true">移除</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="rlr_actions"><button class="rlr_btn" type="button">新增路由</button></div>
          </div>
        </details>

        <details class="rlr_fold">
          <summary data-icon="✎"><span>閘道身份規則</span><span class="rlr_count">1</span></summary>
          <div class="rlr_foldBody">
            <div class="rlr_hint">改寫送往上游的 User-Agent、注入動態 OpenCode ID 與自訂標頭。</div>
            <div class="rlr_provider">
              <div class="rlr_grid">
                <div class="rlr_field"><span class="rlr_label">URL 比對字串</span><input class="rlr_input" type="text" value="opencode.ai/zen" /></div>
                <div class="rlr_field"><span class="rlr_label">User-Agent</span><input class="rlr_input" type="text" value="opencode/1.18.25 ai-sdk/provider-utils/4.0.38" /></div>
                <div class="rlr_field"><span class="rlr_label">自訂標頭</span><textarea class="rlr_textarea" placeholder="x-foo: bar; x-baz: qux"></textarea></div>
                <div class="rlr_field"><label class="rlr_check"><input type="checkbox" checked /> <span>啟用</span></label></div>
              </div>
            </div>
          </div>
        </details>

        <details class="rlr_fold" open>
          <summary data-icon="∿"><span>即時統計</span></summary>
          <div class="rlr_foldBody">
            <div class="rlr_metrics">
${metric("路由數", "3")}
${metric("總請求", "128")}
${metric("已拒絕", "2", "error")}
${metric("曾等待", "11", "warn")}
${metric("平均等待", "412 ms")}
${metric("排隊中", "0")}
${metric("冷卻中", "1", "error")}
            </div>
            <div class="rlr_tableWrap">
              <table class="rlr_table">
                <thead>
                  <tr><th>供應商</th><th>模型</th><th>RPM</th><th>總請求</th><th>曾等待</th><th>已拒絕</th><th>排隊中</th><th>平均等待</th></tr>
                </thead>
                <tbody>
                  <tr><td>nvidia</td><td>deepseek-v4.1-flash</td><td class="rlr_num">60</td><td class="rlr_num">96</td><td class="rlr_num">9</td><td class="rlr_num">2</td><td class="rlr_num">0</td><td class="rlr_num">380 ms</td></tr>
                  <tr><td>openrouter</td><td>（全部）</td><td class="rlr_num">∞</td><td class="rlr_num">32</td><td class="rlr_num">2</td><td class="rlr_num">0</td><td class="rlr_num">0</td><td class="rlr_num">505 ms</td></tr>
                </tbody>
              </table>
            </div>
            <div class="rlr_actions"><button class="rlr_btn" type="button">重設統計</button></div>
          </div>
        </details>

        <div class="rlr_actionBar">
          <button class="rlr_btn" type="button" data-quiet="true" disabled>放棄變更</button>
          <button class="rlr_btn" type="button" data-danger="true">回復預設</button>
          <span class="rlr_spacer"></span>
          <span class="rlr_dirty">尚未儲存</span>
          <button class="rlr_btn" type="button" data-primary="true" disabled>儲存</button>
        </div>
      </div>
    </div>

    <div style="display: flex; align-items: center; gap: 10px; color: var(--dsw-alias-label-secondary); font-size: 12px">
      <span>composer dock line:</span>
      <span class="rlr_statsDock"><b>⏱</b> 20/min ×4 · 128 總請求 · 11 等待 · 2 拒絕 · 0 排隊中 · 3 路由</span>
    </div>

    <script>
      const root = document.documentElement;
      document.getElementById("toggle").addEventListener("click", () => {
        root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      });
    </script>
  </body>
</html>
`;

const out = new URL("./preview.html", import.meta.url);
writeFileSync(out, html);
console.log(`wrote ${out.pathname} (${html.length} chars, ${css.length} chars of shipped CSS)`);
