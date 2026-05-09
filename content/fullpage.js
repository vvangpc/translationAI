// fullpage.js — 整页双语对照翻译
// 暴露 window.__aiTrFullPage = { toggle, translate, clear, isActive }

(() => {
  if (window.__aiTrFullPage) return;

  // —— 配置（运行时从 storage 读，给一个静态副本） ——
  const STATE = {
    active: false,                  // 是否处于"已翻译"模式
    busy: false,
    concurrency: 4,
    batchSize: 15,
    targetLangMode: "auto",
    observer: null,                 // IntersectionObserver
    mutObserver: null,              // MutationObserver
    pending: new Set(),             // 等待翻译的元素
    inflight: 0,
  };

  const BLOCK_TAGS = new Set([
    "P", "H1", "H2", "H3", "H4", "H5", "H6",
    "LI", "BLOCKQUOTE", "DT", "DD",
    "TD", "TH", "FIGCAPTION", "SUMMARY", "CAPTION",
  ]);

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE",
    "TEXTAREA", "INPUT", "SELECT", "BUTTON",
    "SVG", "CANVAS", "VIDEO", "AUDIO", "IFRAME", "OBJECT", "EMBED",
    "MATH", "KBD", "SAMP", "VAR",
  ]);

  const MIN_CHARS = 2;            // 太短不翻
  const MAX_SEG_CHARS = 1500;     // 单段超长则单独发

  const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd, td, th, figcaption, summary, caption";
  const REJECT_ANCESTOR_SELECTOR =
    "code, pre, script, style, textarea, select, button, " +
    '[contenteditable="true"], [contenteditable=""], [translate="no"], ' +
    ".ai-bi-translated, #__ai-translate-bubble-host__";

  function elementText(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isHiddenByStyle(el) {
    const s = getComputedStyle(el);
    return s.display === "none" || s.visibility === "hidden" || +s.opacity === 0;
  }

  function hasMeaningfulText(el) {
    const text = elementText(el);
    if (text.length < MIN_CHARS) return false;
    if (!/[\p{L}]/u.test(text)) return false;
    return true;
  }

  // 单元素谓词（用于 MutationObserver 的新增节点检查）
  function isTranslationUnit(el) {
    if (!el || el.nodeType !== 1) return false;
    if (!BLOCK_TAGS.has(el.tagName)) return false;
    if (el.dataset.aiTrSrc === "1") return false;
    if (el.closest(REJECT_ANCESTOR_SELECTOR)) return false;
    if (el.querySelector(BLOCK_SELECTOR)) return false;   // 含子块就不是叶子单元
    if (!hasMeaningfulText(el)) return false;
    if (isHiddenByStyle(el)) return false;
    return true;
  }

  // 批量采集（优化版）：
  //  1) TreeWalker 用 FILTER_REJECT 剪掉 SCRIPT/STYLE 等整子树，避免无谓深入
  //  2) 候选只做 tag + dataset 廉价检查，不每节点 getComputedStyle / querySelector
  //  3) 用 Set + 祖先删除一次性去掉父子嵌套
  //  4) 最后再做 hasMeaningfulText + isHiddenByStyle 过滤
  function collectUnits(root = document.body) {
    if (!root) return [];
    const candidates = [];
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        // 整个子树跳过（剪枝，节省大量遍历）
        if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
        if (node.classList && node.classList.contains("ai-bi-translated")) return NodeFilter.FILTER_REJECT;
        if (node.id === "__ai-translate-bubble-host__") return NodeFilter.FILTER_REJECT;
        if (node.hasAttribute) {
          const ce = node.getAttribute("contenteditable");
          if (ce === "true" || ce === "") return NodeFilter.FILTER_REJECT;
          if (node.getAttribute("translate") === "no") return NodeFilter.FILTER_REJECT;
        }
        // 候选块级元素：只做廉价检查，accept 后续再过滤
        if (BLOCK_TAGS.has(node.tagName) && node.dataset && node.dataset.aiTrSrc !== "1") {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });
    let n;
    while ((n = tw.nextNode())) candidates.push(n);
    if (!candidates.length) return [];

    // 父子去重：保留最深的块（出现 c 时把它的祖先候选都从 set 移除）
    const set = new Set(candidates);
    for (const c of candidates) {
      let p = c.parentElement;
      while (p) {
        if (set.has(p)) set.delete(p);
        p = p.parentElement;
      }
    }

    // 末端做昂贵的可见性 + 文本质量检查
    const out = [];
    for (const el of set) {
      if (!hasMeaningfulText(el)) continue;
      if (isHiddenByStyle(el)) continue;
      out.push(el);
    }
    return out;
  }

  function makeTranslationNode(text, state = "loading") {
    const div = document.createElement("div");
    div.className = "ai-bi-translated";
    div.setAttribute("data-ai-tr", "1");
    div.setAttribute("data-state", state);
    div.textContent = text;
    return div;
  }

  function attachLoadingPlaceholder(el) {
    if (el.nextElementSibling && el.nextElementSibling.dataset.aiTr === "1") {
      // 已有 placeholder
      return el.nextElementSibling;
    }
    const node = makeTranslationNode("翻译中…", "loading");
    el.dataset.aiTrSrc = "1";
    el.parentNode.insertBefore(node, el.nextSibling);
    return node;
  }

  function setNodeResult(node, translation) {
    node.removeAttribute("data-state");
    node.textContent = translation || "";
  }

  function setNodeError(node, errMsg) {
    node.setAttribute("data-state", "error");
    node.textContent = "✕ " + (errMsg || "翻译失败");
  }

  // —— 简易并发控制 ——
  function makeLimiter(n) {
    let active = 0;
    const queue = [];
    const run = () => {
      while (active < n && queue.length) {
        const { fn, resolve, reject } = queue.shift();
        active++;
        Promise.resolve()
          .then(fn)
          .then(
            (v) => { active--; resolve(v); run(); },
            (e) => { active--; reject(e); run(); }
          );
      }
    };
    return (fn) => new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      run();
    });
  }

  async function translateUnits(units) {
    if (!units.length) return;
    let cfg = {};
    try {
      cfg = await chrome.storage.sync.get(["concurrency", "batchSize", "targetLangMode"]);
    } catch {}
    const concurrency = clampInt(cfg.concurrency, 1, 12, 8);
    const batchSize = clampInt(cfg.batchSize, 1, 30, 3);
    const limit = makeLimiter(concurrency);

    // 先附加 loading 节点
    const placeholders = units.map(attachLoadingPlaceholder);

    // 拆批
    const batches = [];
    let cur = [];
    for (let i = 0; i < units.length; i++) {
      const text = elementText(units[i]);
      if (text.length > MAX_SEG_CHARS) {
        // 超长单独成批
        if (cur.length) { batches.push(cur); cur = []; }
        batches.push([{ idx: i, text }]);
      } else {
        cur.push({ idx: i, text });
        if (cur.length >= batchSize) { batches.push(cur); cur = []; }
      }
    }
    if (cur.length) batches.push(cur);

    await Promise.all(batches.map((batch) =>
      limit(async () => {
        try {
          const texts = batch.map((b) => b.text);
          const resp = await sendMessage({ type: "TRANSLATE_BATCH", texts });
          if (!resp?.ok) throw new Error(resp?.error || "翻译失败");
          batch.forEach((b, j) => {
            const tr = resp.translations[j];
            if (tr) setNodeResult(placeholders[b.idx], tr);
            else setNodeError(placeholders[b.idx], "无返回");
          });
        } catch (e) {
          batch.forEach((b) => setNodeError(placeholders[b.idx], String(e?.message || e)));
        }
      })
    ));
  }

  function clampInt(v, lo, hi, def) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return Math.max(lo, Math.min(hi, n));
    return def;
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else resolve(resp);
        });
      } catch (e) {
        resolve({ ok: false, error: String(e?.message || e) });
      }
    });
  }

  // —— 增量观察（SPA / 懒加载） ——
  // 用 Set + 150ms debounce 把短时多次 mutation 合并成一次批量处理，避免抖动
  let mutPending = new Set();
  let mutTimer = null;

  function flushMutations() {
    mutTimer = null;
    if (!STATE.active) { mutPending.clear(); return; }
    const roots = Array.from(mutPending);
    mutPending.clear();
    if (!roots.length) return;

    const seen = new Set();
    const allUnits = [];
    const pushIfNew = (u) => {
      if (!u || seen.has(u)) return;
      if (u.dataset && u.dataset.aiTrSrc === "1") return;
      seen.add(u);
      allUnits.push(u);
    };

    for (const root of roots) {
      if (!document.documentElement.contains(root)) continue;
      // root 节点本身：TreeWalker 不返回 root，要单独判定
      if (isTranslationUnit(root)) pushIfNew(root);
      // 子树
      for (const u of collectUnits(root)) pushIfNew(u);
    }
    if (!allUnits.length) return;
    // 视口优先：新增内容若在视口内先翻
    allUnits.sort((a, b) => viewportDistance(a) - viewportDistance(b));
    translateUnits(allUnits);
  }

  function scheduleFlushMutations() {
    if (mutTimer) return;
    mutTimer = setTimeout(flushMutations, 150);
  }

  function startObservers() {
    stopObservers();
    STATE.mutObserver = new MutationObserver((muts) => {
      if (!STATE.active) return;
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          // 跳过我们自己注入的元素
          if (n.classList && n.classList.contains("ai-bi-translated")) return;
          if (n.id === "__ai-translate-bubble-host__") return;
          mutPending.add(n);
        });
      }
      if (mutPending.size) scheduleFlushMutations();
    });
    STATE.mutObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopObservers() {
    if (STATE.mutObserver) { STATE.mutObserver.disconnect(); STATE.mutObserver = null; }
    if (mutTimer) { clearTimeout(mutTimer); mutTimer = null; }
    mutPending.clear();
  }

  // —— 视口距离排序：优先翻可视区段落 ——
  function viewportDistance(el) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || 800;
    if (r.bottom < 0) return Math.abs(r.bottom);   // 视口上方
    if (r.top > vh)   return r.top - vh;           // 视口下方
    return 0;                                       // 视口内：最高优先
  }

  // —— 公开 API ——
  async function translateAll() {
    if (STATE.busy) return;
    STATE.busy = true;
    try {
      const units = collectUnits();
      // 视口优先：可视区段落排前面，再按到视口距离升序
      units.sort((a, b) => viewportDistance(a) - viewportDistance(b));
      await translateUnits(units);
      STATE.active = true;
      document.documentElement.removeAttribute("data-ai-tr-hidden");
      startObservers();
    } finally {
      STATE.busy = false;
    }
  }

  function clearAll() {
    document.querySelectorAll(".ai-bi-translated[data-ai-tr='1']").forEach((n) => n.remove());
    document.querySelectorAll("[data-ai-tr-src='1']").forEach((n) => {
      delete n.dataset.aiTrSrc;
    });
    document.documentElement.removeAttribute("data-ai-tr-hidden");
    STATE.active = false;
    stopObservers();
  }

  function setHidden(hidden) {
    if (hidden) document.documentElement.setAttribute("data-ai-tr-hidden", "1");
    else document.documentElement.removeAttribute("data-ai-tr-hidden");
  }

  // toggle 行为：
  //   未翻译 → 翻译并显示
  //   已翻译显示中 → 隐藏
  //   已翻译隐藏中 → 显示
  async function toggle() {
    const hasTranslations = !!document.querySelector(".ai-bi-translated[data-ai-tr='1']");
    if (!hasTranslations) {
      // fire-and-forget：让 popup/快捷键立刻拿到响应，翻译在后台进行
      translateAll().catch((e) => console.warn("[喵喵翻译] translateAll failed:", e));
      return { state: "translating" };
    }
    const hidden = document.documentElement.getAttribute("data-ai-tr-hidden") === "1";
    setHidden(!hidden);
    return { state: hidden ? "shown" : "hidden" };
  }

  window.__aiTrFullPage = {
    toggle,
    translate: translateAll,
    clear: clearAll,
    setHidden,
    isActive: () => STATE.active,
    hasTranslations: () => !!document.querySelector(".ai-bi-translated[data-ai-tr='1']"),
  };
})();
