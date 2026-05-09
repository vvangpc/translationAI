// content.js — 入口：选区监听 + 消息接收
// 依赖：window.__aiTrBubble（selection-bubble.js）和 window.__aiTrFullPage（fullpage.js）

(() => {
  const Bubble = window.__aiTrBubble;
  const Full = window.__aiTrFullPage;
  if (!Bubble || !Full) {
    console.warn("[喵喵翻译] content scripts 未完整加载");
    return;
  }

  // —— 域名黑名单：命中则禁用「划词图标自动弹出」（其他主动操作不影响）——
  let pageBlocked = false;

  function isBlocked(hostname, blocklist) {
    if (!blocklist || !blocklist.length) return false;
    const h = (hostname || "").toLowerCase();
    return blocklist.some(d => {
      const dd = (d || "").trim().toLowerCase();
      if (!dd) return false;
      return h === dd || h.endsWith("." + dd);
    });
  }

  // ready Promise：等异步初始化完成再放行划词触发，避免初始竞态把"应被屏蔽"的域弹一次
  const blocklistReady = (async () => {
    try {
      const r = await chrome.storage.sync.get(["blocklist"]);
      pageBlocked = isBlocked(location.hostname, r.blocklist || []);
    } catch {}
  })();

  // 监听黑名单变更（来自 popup 或 options）
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.blocklist) {
        pageBlocked = isBlocked(location.hostname, changes.blocklist.newValue || []);
        if (pageBlocked) Bubble.hide();   // 立刻收掉可能正在显示的图标
      }
    });
  } catch {}

  function captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    let rect;
    if (rects && rects.length) {
      // 用最后一个 rect 的右下角作为锚点（更贴近鼠标释放位置）
      const last = rects[rects.length - 1];
      rect = { left: last.left, top: last.top, right: last.right, bottom: last.bottom };
    } else {
      const r = range.getBoundingClientRect();
      rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    return { text, rect };
  }

  function onSelectionDone(evt) {
    // 事件发生在我们自己的气泡 UI 内部时（点击图标/操作面板），忽略
    if (evt && evt.target) {
      const host = document.getElementById("__ai-translate-bubble-host__");
      if (host && (host === evt.target || host.contains(evt.target))) return;
    }
    // mouseup/keyup 后稍延后取，让浏览器先完成选区；同时等黑名单初始化完成再判定
    setTimeout(async () => {
      await blocklistReady;
      if (pageBlocked) return;        // 命中黑名单：跳过自动弹图标
      const cap = captureSelection();
      if (!cap) {
        // 不主动 hide：让 mousedown 全局监听处理
        return;
      }
      // 不在我们自己的 host 里
      const sel = window.getSelection();
      const anchor = sel.anchorNode;
      if (anchor && anchor.parentElement && anchor.parentElement.closest("#__ai-translate-bubble-host__")) return;

      Bubble.showIcon(cap.rect, () => doTranslateSelection(cap.text, cap.rect));
    }, 10);
  }

  async function doTranslateSelection(text, rect) {
    const ctx = {
      sourceText: text,
      engine: null,
      retranslate: () => doTranslateSelection(text, rect),
    };
    // 1) 立刻同步显示 loading（chip 暂为空）
    Bubble.showLoading(rect, ctx);
    // 2) 异步读取当前引擎，到了就只刷新 chip，不重绘面板
    chrome.storage.sync.get(["engine"]).then((r) => {
      Bubble.setEngine(r?.engine || "llm");
    }).catch(() => {});
    // 3) 翻译
    try {
      const resp = await sendMessage({ type: "TRANSLATE_ONE", text });
      if (!resp?.ok) {
        Bubble.showError(rect, resp?.error || "翻译失败", ctx);
        return;
      }
      ctx.engine = resp.engine || ctx.engine || "llm";
      Bubble.showResult(rect, resp.translation, resp.targetLang, ctx);
    } catch (e) {
      Bubble.showError(rect, String(e?.message || e), ctx);
    }
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(resp);
        });
      } catch (e) {
        resolve({ ok: false, error: String(e?.message || e) });
      }
    });
  }

  // 划词触发
  document.addEventListener("mouseup", onSelectionDone, true);
  document.addEventListener("keyup", (e) => {
    // 仅在 Shift+方向键 / Cmd+A 等可能改选区的键释放时检查
    if (["Shift", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "a", "A"].includes(e.key)) {
      onSelectionDone();
    }
  }, true);

  // 接收 background 消息
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      if (msg?.type === "TRANSLATE_SELECTION_FROM_MENU" || msg?.type === "TRANSLATE_SELECTION_FROM_SHORTCUT") {
        // 当前选区
        const cap = captureSelection() || (msg.text ? { text: msg.text, rect: anchorRect() } : null);
        if (!cap || !cap.text) {
          sendResponse({ ok: false, error: "没有选中文本" });
          return;
        }
        await doTranslateSelection(cap.text, cap.rect);
        sendResponse({ ok: true });
      } else if (msg?.type === "TOGGLE_PAGE_TRANSLATE") {
        const r = await Full.toggle();
        sendResponse({ ok: true, ...r });
      } else if (msg?.type === "CLEAR_PAGE_TRANSLATE") {
        Full.clear();
        sendResponse({ ok: true });
      } else if (msg?.type === "GET_PAGE_TR_STATE") {
        sendResponse({
          ok: true,
          hasTranslations: Full.hasTranslations(),
          hidden: document.documentElement.getAttribute("data-ai-tr-hidden") === "1",
        });
      } else {
        sendResponse({ ok: false, error: "unknown message type" });
      }
    })();
    return true;
  });

  function anchorRect() {
    // 没有选区时（例如快捷键时选区已丢失），用屏幕中心作为锚
    const w = window.innerWidth, h = window.innerHeight;
    return { left: w / 2 - 10, top: h / 2 - 10, right: w / 2 + 10, bottom: h / 2 + 10 };
  }
})();
