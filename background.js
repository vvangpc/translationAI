// background.js — Service Worker
// 职责：调用翻译引擎（LLM/Google）、持久化缓存、右键菜单、快捷键、配置从 sync 读取

const DEFAULTS = {
  engine: "llm",                  // llm | google
  baseUrl: "",
  apiKey: "",
  model: "",
  systemPrompt:
    "You are a professional translator. Translate the user's text faithfully and naturally. Output only the translation, no explanations, no quotes, preserve original line breaks.",
  targetLangMode: "auto",         // auto | zh | en
  disableThinking: true,          // DeepSeek V3.1+ 默认关闭思考模式
  blocklist: [],                  // string[]，按 hostname 后缀匹配，命中则禁划词图标自动弹出
};

const SYNC_FIELDS = Object.keys(DEFAULTS);

// ---------- 配置读取（从 chrome.storage.sync，带内存缓存）----------
let cfgCache = null;
let cfgPromise = null;          // in-flight read，防并发请求各起一次 IPC

async function getConfig() {
  if (cfgCache) return cfgCache;
  if (!cfgPromise) {
    cfgPromise = (async () => {
      let stored = {};
      try {
        stored = await chrome.storage.sync.get(SYNC_FIELDS);
      } catch (e) {
        // 隐身/访客模式或同步禁用时 sync 可能不可用：用 DEFAULTS 兜底
        console.warn("[喵喵翻译] storage.sync 读取失败，使用默认值:", e);
      }
      cfgCache = { ...DEFAULTS, ...stored };
      cfgPromise = null;
      return cfgCache;
    })();
  }
  return cfgPromise;
}

// 配置变更（含跨设备同步）即失效缓存，下一次 getConfig 重新读
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    cfgCache = null;
    cfgPromise = null;
  }
});

// ---------- 目标语言判定 ----------
function detectTargetLang(text, mode) {
  if (mode === "zh") return "简体中文";
  if (mode === "en") return "English";
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const total = text.replace(/\s/g, "").length || 1;
  return cjk / total > 0.3 ? "English" : "简体中文";
}

// ---------- 持久化 LRU 缓存（chrome.storage.local）----------
const STORAGE_KEY = "__translation_cache_v1";
const CACHE_MAX = 1000;
let cache = new Map();
let cacheLoaded = false;
let persistTimer = null;

async function ensureCacheLoaded() {
  if (cacheLoaded) return;
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    const arr = r[STORAGE_KEY];
    if (Array.isArray(arr)) cache = new Map(arr);
  } catch {}
  cacheLoaded = true;
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    const arr = Array.from(cache.entries()).slice(-CACHE_MAX);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: arr });
    } catch {}
  }, 1500);
}

function cacheKey(engine, model, target, text) {
  return `${engine}|${model || "_"}|${target}|${text}`;
}
function cacheGet(k) {
  if (!cache.has(k)) return null;
  const v = cache.get(k);
  // 空字符串视作 miss：避免曾经误存的空译文造成永久 cache hit
  if (!v) {
    cache.delete(k);
    return null;
  }
  // LRU 触底刷新
  cache.delete(k);
  cache.set(k, v);
  return v;
}
function cacheSet(k, v) {
  if (cache.has(k)) cache.delete(k);
  cache.set(k, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  schedulePersist();
}

// ---------- 通用 fetch 工具：30s 超时 + AbortError 友好化 ----------
const FETCH_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url, init) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error(`请求超时（${FETCH_TIMEOUT_MS / 1000}s 内无响应）`);
    }
    throw e;
  }
}

// ---------- LLM 引擎（OpenAI 兼容）----------
async function llmTranslateOne(text, targetLang, cfg) {
  const url = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const body = {
    model: cfg.model,
    messages: [
      { role: "system", content: cfg.systemPrompt },
      { role: "user", content: `Translate the following text into ${targetLang}. Output only the translation.\n\n${text}` },
    ],
    temperature: 0.2,
    stream: false,
  };
  if (cfg.disableThinking) body.thinking = { type: "disabled" };

  const resp = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  const out = data?.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error("API 返回空内容");
  return out;
}

// ---------- Google 翻译引擎（free 端点）----------
function googleLangCode(target) {
  if (!target) return "zh-CN";
  if (/中文|chinese/i.test(target)) return "zh-CN";
  if (/english/i.test(target))      return "en";
  return target;
}

async function googleTranslateOnce(text, tl) {
  const url = `https://translate.googleapis.com/translate_a/single`
    + `?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
  const resp = await fetchWithTimeout(url, { method: "GET" });
  if (!resp.ok) {
    const e = new Error(`Google ${resp.status}`);
    e.status = resp.status;
    throw e;
  }
  const data = await resp.json();
  const segs = (data && data[0]) || [];
  return segs.map(s => s && s[0] ? s[0] : "").join("");
}

async function googleTranslateOne(text, targetLang) {
  const tl = googleLangCode(targetLang);
  try {
    return await googleTranslateOnce(text, tl);
  } catch (e) {
    if (e.status === 429 || e.status === 503) {
      // 一次退避重试
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));
      return await googleTranslateOnce(text, tl);
    }
    throw e;
  }
}

// ---------- 顶层翻译 API ----------
async function translateOne(text, opts = {}) {
  // 临时配置不读 sync、不读写缓存（用于 options 的"测试连接"）
  const tempCfg = opts.overrideConfig
    ? { ...DEFAULTS, ...opts.overrideConfig }
    : null;
  if (!tempCfg) await ensureCacheLoaded();
  const cfg = tempCfg || (await getConfig());
  const targetLang = opts.targetLang || detectTargetLang(text, cfg.targetLangMode);

  if (!tempCfg) {
    const k = cacheKey(cfg.engine, cfg.engine === "google" ? "google" : cfg.model, targetLang, text);
    const hit = cacheGet(k);
    if (hit) return { translation: hit, targetLang, engine: cfg.engine };
  }

  let out;
  if (cfg.engine === "google") {
    out = await googleTranslateOne(text, targetLang);
  } else {
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
      throw new Error("未配置 LLM API：请在设置页填写 Base URL / API Key / Model，或将引擎切换为 Google。");
    }
    out = await llmTranslateOne(text, targetLang, cfg);
  }
  if (out && !tempCfg) {
    const k = cacheKey(cfg.engine, cfg.engine === "google" ? "google" : cfg.model, targetLang, text);
    cacheSet(k, out);
  }
  return { translation: out, targetLang, engine: cfg.engine };
}

// ---------- 消息路由 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "TRANSLATE_ONE") {
        const r = await translateOne(msg.text, {
          targetLang: msg.targetLang,
          overrideConfig: msg.overrideConfig,
        });
        sendResponse({ ok: true, ...r });
      } else if (msg?.type === "PING") {
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});

// ---------- 安装/升级钩子：菜单 + 一次性配置迁移（local → sync）----------
const MIGRATION_FLAG = "__migrated_to_sync_v1";

chrome.runtime.onInstalled.addListener(async () => {
  // 右键菜单：先清后建，避免 reload 时重复 id
  try {
    await new Promise((r) => chrome.contextMenus.removeAll(r));
    chrome.contextMenus.create({
      id: "translate-selection",
      title: "翻译: %s",
      contexts: ["selection"],
    });
  } catch (e) {
    console.warn("[喵喵翻译] contextMenus 创建失败:", e);
  }

  // 一次性迁移：把旧 local 里的配置搬到 sync
  try {
    const flag = await chrome.storage.local.get(MIGRATION_FLAG);
    if (flag[MIGRATION_FLAG]) return;

    const old = await chrome.storage.local.get(SYNC_FIELDS);
    const toSync = {};
    for (const k of SYNC_FIELDS) if (old[k] !== undefined) toSync[k] = old[k];
    if (Object.keys(toSync).length) {
      await chrome.storage.sync.set(toSync);
      await chrome.storage.local.remove(SYNC_FIELDS);
      console.log("[喵喵翻译] 已将旧配置迁移到 chrome.storage.sync");
    }
    await chrome.storage.local.set({ [MIGRATION_FLAG]: true });
  } catch (e) {
    console.warn("[喵喵翻译] 配置迁移失败（不影响使用）:", e);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "translate-selection") {
    chrome.tabs.sendMessage(tab.id, {
      type: "TRANSLATE_SELECTION_FROM_MENU",
      text: info.selectionText || "",
    });
  }
});

// ---------- 快捷键 ----------
chrome.commands.onCommand.addListener(async (cmd) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (cmd === "translate-selection") {
    chrome.tabs.sendMessage(tab.id, { type: "TRANSLATE_SELECTION_FROM_SHORTCUT" });
  }
});
