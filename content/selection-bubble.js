// selection-bubble.js — 划词气泡（Shadow DOM 隔离样式）
// 暴露全局 window.__aiTrBubble = { showAt, showLoading, showResult, showError, hide }

(() => {
  if (window.__aiTrBubble) return;

  const HOST_ID = "__ai-translate-bubble-host__";
  let hostEl = null;
  let shadow = null;
  let rootEl = null;
  let iconEl = null;
  let panelEl = null;

  const COPY_SVG = `
    <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="6.5" y="6.5" width="10" height="11.5" rx="2"
            fill="none" stroke="currentColor" stroke-width="1.5"/>
      <path d="M 4 13.5 L 4 3.5 a 1 1 0 0 1 1 -1 l 7 0 a 1 1 0 0 1 1 1 L 13 5"
            fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  const CHECK_SVG = `
    <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M 4 10.5 L 8 14.5 L 16 6.5"
            fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  // 内嵌吉祥物 SVG（Q 版小猫咪头像：大眼睛 + 胖脸 + 闪亮高光）—— 与 icons/ 一致
  const MASCOT_SVG = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <polygon points="4.32,7.20 9.60,5.76 4.32,1.44" fill="#FFFFFF"/>
      <polygon points="14.40,5.76 19.68,7.20 19.68,1.44" fill="#FFFFFF"/>
      <polygon points="5.28,6.48 8.16,5.76 5.28,3.12" fill="#FF8B7A"/>
      <polygon points="15.84,5.76 18.72,6.48 18.72,3.12" fill="#FF8B7A"/>
      <ellipse cx="12" cy="14.4" rx="9.12" ry="8.16" fill="#FFFFFF"/>
      <circle cx="8.40" cy="13.92" r="2.40" fill="#2C3E50"/>
      <circle cx="15.60" cy="13.92" r="2.40" fill="#2C3E50"/>
      <circle cx="7.68" cy="12.84" r="0.84" fill="#FFFFFF"/>
      <circle cx="14.88" cy="12.84" r="0.84" fill="#FFFFFF"/>
      <polygon points="11.04,17.28 12.96,17.28 12,18.48" fill="#FF8B7A"/>
      <path d="M 10.08,18.96 a 0.96,0.72 0 0 1 1.92,0 a 0.96,0.72 0 0 1 1.92,0"
            stroke="#2C3E50" stroke-width="0.55" fill="none" stroke-linecap="round"/>
    </svg>
  `;

  const STYLE = `
    :host { all: initial; }
    @keyframes ai-pop-in {
      0%   { transform: scale(0.6); opacity: 0; }
      60%  { transform: scale(1.08); opacity: 1; }
      100% { transform: scale(1);    opacity: 1; }
    }
    @keyframes ai-fade-in {
      from { transform: translateY(-4px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    @keyframes ai-bounce {
      0%, 100% { transform: translateY(0); }
      50%      { transform: translateY(-2px); }
    }
    .wrap {
      position: fixed;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Microsoft YaHei", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.55;
      color: #2C3E50;
    }
    .icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px; height: 30px;
      background: #4ECDC4;
      color: #fff;
      border-radius: 10px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(78, 205, 196, 0.40), 0 1px 3px rgba(0,0,0,0.08);
      user-select: none;
      transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
      animation: ai-pop-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
      border: 2px solid #FFFFFF;
    }
    .icon svg { width: 20px; height: 20px; display: block; }
    .icon:hover {
      background: #3DB8AF;
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(78, 205, 196, 0.50), 0 1px 3px rgba(0,0,0,0.10);
    }
    .icon:active { transform: scale(0.94); }
    .panel {
      min-width: 240px;
      max-width: 440px;
      background: #FFFFFF;
      color: #2C3E50;
      border: 1px solid #E0EDEB;
      border-radius: 14px;
      box-shadow: 0 12px 32px rgba(44, 62, 80, 0.16), 0 2px 6px rgba(78, 205, 196, 0.10);
      overflow: hidden;
      animation: ai-fade-in 0.2s ease-out;
    }
    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px;
      background: linear-gradient(135deg, #4ECDC4 0%, #5FD4CC 100%);
      color: #FFFFFF;
      font-size: 12px;
      font-weight: 600;
    }
    .header .lang-wrap { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .header .mascot {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px;
      animation: ai-bounce 1.6s ease-in-out infinite;
    }
    .header .mascot svg { width: 16px; height: 16px; display: block; }
    .header .lang { color: #FFFFFF; letter-spacing: 0.2px; }
    .header .engine-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 7px 1px 7px;
      background: rgba(255,255,255,0.22);
      border: 1px solid rgba(255,255,255,0.32);
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      color: #FFFFFF;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s ease, transform 0.12s ease;
      letter-spacing: 0.3px;
    }
    .header .engine-chip:hover { background: rgba(255,255,255,0.36); }
    .header .engine-chip:active { transform: scale(0.94); }
    .header .engine-chip[data-engine="google"] {
      background: rgba(255, 184, 77, 0.40);
      border-color: rgba(255, 184, 77, 0.65);
    }
    .header .engine-chip[data-engine="google"]:hover { background: rgba(255, 184, 77, 0.58); }
    .header .engine-chip .arrow { font-size: 9px; opacity: 0.85; }
    @keyframes ai-chip-flash {
      0%   { transform: scale(1); }
      40%  { transform: scale(1.15); background: rgba(255,255,255,0.55); }
      100% { transform: scale(1); }
    }
    .header .engine-chip.flash { animation: ai-chip-flash 0.32s ease; }
    .close {
      cursor: pointer;
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      color: #FFFFFF;
      font-size: 16px;
      line-height: 1;
      user-select: none;
      border-radius: 50%;
      transition: background 0.15s ease;
    }
    .close:hover { background: rgba(255,255,255,0.22); }
    .header-actions { display: inline-flex; align-items: center; gap: 4px; }
    .copy {
      cursor: pointer;
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      color: #FFFFFF;
      border-radius: 6px;
      transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
    }
    .copy:hover { background: rgba(255,255,255,0.22); }
    .copy:active { transform: scale(0.92); }
    .copy svg { width: 14px; height: 14px; display: block; }
    .copy.copied { color: #BFFFE6; background: rgba(255,255,255,0.18); }
    .copy.hidden { display: none; }
    .body {
      padding: 12px 14px;
      max-height: 340px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      background: #FFFDF7;
    }
    .body.loading { color: #6B7B8C; font-style: italic; }
    .body.loading::before { content: "🌱 "; }
    .body.error { color: #C44545; background: #FFF5F5; }
    .body.error::before { content: "⚠️ "; }

    /* 自定义滚动条 */
    .body::-webkit-scrollbar { width: 6px; }
    .body::-webkit-scrollbar-thumb { background: #C5E8E5; border-radius: 3px; }
    .body::-webkit-scrollbar-thumb:hover { background: #4ECDC4; }

    @media (prefers-color-scheme: dark) {
      .wrap { color: #E5EDED; }
      .panel {
        background: #1E2832;
        color: #E5EDED;
        border-color: #2A3540;
        box-shadow: 0 12px 32px rgba(0,0,0,0.50), 0 2px 6px rgba(78, 205, 196, 0.16);
      }
      .body { background: #142028; }
      .body.loading { color: #9CB1B0; }
      .body.error { color: #FFA8A8; background: #2A1818; }
      .body::-webkit-scrollbar-thumb { background: #2F4A47; }
      .body::-webkit-scrollbar-thumb:hover { background: #4ECDC4; }
    }
  `;

  function ensureMounted() {
    if (hostEl && document.documentElement.contains(hostEl)) return;
    hostEl = document.createElement("div");
    hostEl.id = HOST_ID;
    hostEl.style.cssText = "all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;";
    document.documentElement.appendChild(hostEl);
    shadow = hostEl.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);

    rootEl = document.createElement("div");
    rootEl.className = "wrap";
    shadow.appendChild(rootEl);
  }

  function clearRoot() {
    if (rootEl) rootEl.innerHTML = "";
    iconEl = null;
    panelEl = null;
  }

  function positionAt(rect) {
    ensureMounted();
    // rect 是 viewport 坐标；rootEl 用 fixed 即可
    const margin = 4;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.right + margin;
    let top = rect.bottom + margin;
    rootEl.style.left = left + "px";
    rootEl.style.top = top + "px";
    // rAF 内做溢出修正：用户可能在这一帧内 hide()，需要 null guard
    requestAnimationFrame(() => {
      if (!rootEl) return;
      const r = rootEl.getBoundingClientRect();
      if (left + r.width > vw - 8) left = Math.max(8, vw - r.width - 8);
      if (top + r.height > vh - 8) top = Math.max(8, rect.top - r.height - margin);
      rootEl.style.left = left + "px";
      rootEl.style.top = top + "px";
    });
  }

  function showIcon(rect, onClick) {
    ensureMounted();
    clearRoot();
    iconEl = document.createElement("div");
    iconEl.className = "icon";
    iconEl.title = "点击翻译 (Alt+T)";
    iconEl.innerHTML = MASCOT_SVG;
    iconEl.addEventListener("mousedown", (e) => {
      // 阻止 mousedown 清除 selection
      e.preventDefault();
      e.stopPropagation();
    });
    iconEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick && onClick();
    });
    rootEl.appendChild(iconEl);
    positionAt(rect);
  }

  // 当前面板上下文（保存 sourceText / retranslate 回调，供 engine chip 切换时复用）
  let currentCtx = null;

  function ensurePanel(rect) {
    ensureMounted();
    clearRoot();
    panelEl = document.createElement("div");
    panelEl.className = "panel";
    panelEl.innerHTML = `
      <div class="header">
        <span class="lang-wrap">
          <span class="mascot">${MASCOT_SVG}</span>
          <span class="engine-chip" data-engine="" title="点击切换引擎并重译">
            <span class="engine-name">…</span>
            <span class="arrow">⇄</span>
          </span>
          <span class="lang"></span>
        </span>
        <span class="header-actions">
          <span class="copy hidden" title="复制译文">${COPY_SVG}</span>
          <span class="close" title="关闭 (Esc)">×</span>
        </span>
      </div>
      <div class="body"></div>
    `;
    panelEl.querySelector(".close").addEventListener("click", () => hide());
    panelEl.querySelector(".engine-chip").addEventListener("click", onEngineChipClick);
    panelEl.querySelector(".copy").addEventListener("click", onCopyClick);
    // 防止气泡内点击冒泡到 document，导致划词重新触发
    panelEl.addEventListener("mousedown", (e) => e.stopPropagation());
    panelEl.addEventListener("click", (e) => e.stopPropagation());
    rootEl.appendChild(panelEl);
    positionAt(rect);
    return panelEl;
  }

  function setEngineChip(engine) {
    if (!panelEl) return;
    const chip = panelEl.querySelector(".engine-chip");
    if (!chip) return;
    const known = engine === "google" ? "google" : "llm";
    chip.setAttribute("data-engine", known);
    const label = known === "google" ? "Google" : "LLM";
    chip.querySelector(".engine-name").textContent = label;
    // 闪一下，让用户感知它变了
    chip.classList.remove("flash");
    void chip.offsetWidth;   // 强制 reflow 重启动画
    chip.classList.add("flash");
  }

  function setCopyVisible(visible) {
    if (!panelEl) return;
    const btn = panelEl.querySelector(".copy");
    if (!btn) return;
    btn.classList.toggle("hidden", !visible);
    if (!visible) {
      btn.classList.remove("copied");
      btn.innerHTML = COPY_SVG;
    }
  }

  async function onCopyClick() {
    if (!panelEl) return;
    const text = panelEl.querySelector(".body")?.textContent || "";
    if (!text) return;
    const btn = panelEl.querySelector(".copy");
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        btn.innerHTML = CHECK_SVG;
        btn.classList.add("copied");
        btn.title = "已复制 ✓";
        setTimeout(() => {
          if (!panelEl) return;
          const cur = panelEl.querySelector(".copy");
          if (!cur) return;
          cur.innerHTML = COPY_SVG;
          cur.classList.remove("copied");
          cur.title = "复制译文";
        }, 1200);
      }
    } catch (e) {
      console.warn("[喵喵翻译] 复制失败:", e);
    }
  }

  async function onEngineChipClick() {
    if (!currentCtx || !currentCtx.retranslate) return;
    const chip = panelEl && panelEl.querySelector(".engine-chip");
    const cur = chip ? chip.getAttribute("data-engine") : "llm";
    const next = cur === "google" ? "llm" : "google";
    try {
      await chrome.storage.sync.set({ engine: next });
    } catch (e) {
      console.warn("[喵喵翻译] 切换引擎失败:", e);
      return;
    }
    setEngineChip(next);
    // 立刻用新引擎重译
    currentCtx.retranslate();
  }

  function showLoading(rect, ctx) {
    const p = ensurePanel(rect);
    if (ctx) currentCtx = ctx;
    if (currentCtx && currentCtx.engine) setEngineChip(currentCtx.engine);
    p.querySelector(".lang").textContent = "翻译中…";
    const body = p.querySelector(".body");
    body.className = "body loading";
    body.textContent = "请稍候…";
    setCopyVisible(false);
  }

  function showResult(rect, translation, targetLang, ctx) {
    const p = panelEl && document.documentElement.contains(hostEl) ? panelEl : ensurePanel(rect);
    if (ctx) currentCtx = ctx;
    if (currentCtx && currentCtx.engine) setEngineChip(currentCtx.engine);
    p.querySelector(".lang").textContent = `→ ${targetLang || ""}`;
    const body = p.querySelector(".body");
    body.className = "body";
    body.textContent = translation || "";
    setCopyVisible(!!translation);
    positionAt(rect);
  }

  function showError(rect, err, ctx) {
    const p = panelEl && document.documentElement.contains(hostEl) ? panelEl : ensurePanel(rect);
    if (ctx) currentCtx = ctx;
    if (currentCtx && currentCtx.engine) setEngineChip(currentCtx.engine);
    p.querySelector(".lang").textContent = "出错了";
    const body = p.querySelector(".body");
    body.className = "body error";
    body.textContent = err || "未知错误";
    setCopyVisible(false);
    positionAt(rect);
  }

  function hide() {
    if (hostEl && hostEl.parentNode) {
      hostEl.parentNode.removeChild(hostEl);
    }
    hostEl = null;
    shadow = null;
    rootEl = null;
    iconEl = null;
    panelEl = null;
    currentCtx = null;
  }

  function isInsideHost(node) {
    return hostEl && (hostEl === node || hostEl.contains(node));
  }

  // 全局 Esc / 外部点击关闭
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  document.addEventListener("mousedown", (e) => {
    if (!hostEl) return;
    if (isInsideHost(e.target)) return;
    hide();
  });

  // 仅刷新 chip 的引擎显示，不重绘面板（用于 loading 阶段异步拿到引擎名后填充）
  function setEngine(engine) {
    if (currentCtx) currentCtx.engine = engine;
    setEngineChip(engine);
  }

  window.__aiTrBubble = {
    showIcon,
    showLoading,
    showResult,
    showError,
    setEngine,
    hide,
  };
})();
