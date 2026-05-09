async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function send(tabId, msg) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, msg, (r) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(r);
      });
    } catch (e) {
      resolve({ ok: false, error: String(e?.message || e) });
    }
  });
}

function isBlocked(hostname, blocklist) {
  if (!blocklist || !blocklist.length) return false;
  const h = (hostname || "").toLowerCase();
  return blocklist.some(d => {
    const dd = (d || "").trim().toLowerCase();
    if (!dd) return false;
    return h === dd || h.endsWith("." + dd);
  });
}

function isHostExact(hostname, blocklist) {
  return Array.isArray(blocklist) && blocklist.includes(hostname);
}

async function getBlocklist() {
  try {
    const r = await chrome.storage.sync.get(["blocklist"]);
    return Array.isArray(r.blocklist) ? r.blocklist : [];
  } catch { return []; }
}

async function setBlocklist(list) {
  try { await chrome.storage.sync.set({ blocklist: list }); } catch {}
}

let currentHost = "";
let currentSupported = false;

async function refresh() {
  let cfg = {};
  try {
    cfg = await chrome.storage.sync.get(["engine", "baseUrl", "apiKey", "model"]);
  } catch {}
  const engine = cfg.engine || "llm";
  // Google 引擎不需要 key；LLM 引擎需要三件套
  const configured = engine === "google" || (cfg.baseUrl && cfg.apiKey && cfg.model);
  document.getElementById("warn").classList.toggle("hidden", !!configured);

  const tab = await getActiveTab();

  // —— 当前页 host 与黑名单状态 ——
  const url = tab?.url || "";
  let host = "";
  try { host = new URL(url).hostname; } catch {}
  const supported = !!host && !/^(chrome|edge|about|chrome-extension|chrome-search|view-source):/.test(url);
  currentHost = host;
  currentSupported = supported;

  const list = await getBlocklist();
  const blocked = supported && isBlocked(host, list);
  const exact = supported && isHostExact(host, list);

  const bb = document.getElementById("blocklistBtn");
  const bd = document.getElementById("blocklistDomain");
  if (!supported) {
    bb.disabled = true;
    bb.textContent = "当前页面不支持";
    bb.classList.remove("active");
    bd.textContent = "";
  } else if (blocked && !exact) {
    // 当前页被父域规则命中（如 *.x.com 命中 mobile.x.com），不允许在 popup 直接移除
    bb.disabled = true;
    bb.textContent = "✓ 已被规则禁用";
    bb.classList.add("active");
    bd.textContent = `命中规则；请到设置编辑列表`;
  } else {
    bb.disabled = false;
    bb.textContent = blocked ? "✓ 移出黑名单" : "⊘ 加入黑名单";
    bb.classList.toggle("active", blocked);
    bd.textContent = blocked ? `已禁用：${host}` : `当前：${host}`;
  }

  // —— 整页翻译按钮文本 ——
  if (!tab?.id) return;
  const r = await send(tab.id, { type: "GET_PAGE_TR_STATE" });
  const btn = document.getElementById("toggleBtn");
  if (r?.ok) {
    if (!r.hasTranslations) btn.textContent = "整页翻译";
    else if (r.hidden) btn.textContent = "显示译文";
    else btn.textContent = "隐藏译文";
  }
}

async function onToggle() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  // 不 await：整页翻译是后台 fire-and-forget，立即关闭 popup
  send(tab.id, { type: "TOGGLE_PAGE_TRANSLATE" });
  window.close();
}

async function onClear() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  await send(tab.id, { type: "CLEAR_PAGE_TRANSLATE" });
  await refresh();
}

async function onBlocklistToggle() {
  if (!currentHost || !currentSupported) return;
  const list = await getBlocklist();
  const idx = list.indexOf(currentHost);
  let next;
  if (idx >= 0) {
    next = list.slice();
    next.splice(idx, 1);
  } else {
    next = [...list, currentHost];
  }
  await setBlocklist(next);
  await refresh();
}

document.addEventListener("DOMContentLoaded", () => {
  refresh();
  document.getElementById("toggleBtn").addEventListener("click", onToggle);
  document.getElementById("clearBtn").addEventListener("click", onClear);
  document.getElementById("optionsBtn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById("blocklistBtn").addEventListener("click", onBlocklistToggle);
});
