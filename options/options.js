const FIELDS = {
  engine: "llm",
  baseUrl: "",
  apiKey: "",
  model: "",
  systemPrompt:
    "You are a professional translator. Translate the user's text faithfully and naturally. Output only the translation, no explanations, no quotes, preserve original line breaks.",
  targetLangMode: "auto",
  disableThinking: true,
  scrollCloseThreshold: 100,
  blocklist: [],
};

const SYNC_FIELDS = Object.keys(FIELDS);

async function syncGet(keys) {
  try {
    return await chrome.storage.sync.get(keys);
  } catch (e) {
    console.warn("[喵喵翻译] storage.sync 不可用，回退默认:", e);
    return {};
  }
}

async function syncSet(obj) {
  try {
    await chrome.storage.sync.set(obj);
    return true;
  } catch (e) {
    console.warn("[喵喵翻译] storage.sync 写入失败:", e);
    return false;
  }
}

function blocklistToText(list) {
  return Array.isArray(list) ? list.filter(Boolean).join("\n") : "";
}

function textToBlocklist(text) {
  return (text || "")
    .split(/\r?\n/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);   // 去重
}

async function load() {
  const stored = await syncGet(SYNC_FIELDS);
  const cfg = { ...FIELDS, ...stored };
  document.getElementById("engine").value = cfg.engine;
  document.getElementById("baseUrl").value = cfg.baseUrl;
  document.getElementById("apiKey").value = cfg.apiKey;
  document.getElementById("model").value = cfg.model;
  document.getElementById("systemPrompt").value = cfg.systemPrompt;
  document.getElementById("targetLangMode").value = cfg.targetLangMode;
  document.getElementById("disableThinking").checked = cfg.disableThinking !== false;
  document.getElementById("scrollCloseThreshold").value = cfg.scrollCloseThreshold;
  document.getElementById("blocklist").value = blocklistToText(cfg.blocklist);
  applyEngineUI();
}

function readForm() {
  return {
    engine: document.getElementById("engine").value,
    baseUrl: document.getElementById("baseUrl").value.trim(),
    apiKey: document.getElementById("apiKey").value.trim(),
    model: document.getElementById("model").value.trim(),
    systemPrompt: document.getElementById("systemPrompt").value.trim() || FIELDS.systemPrompt,
    targetLangMode: document.getElementById("targetLangMode").value,
    disableThinking: document.getElementById("disableThinking").checked,
    scrollCloseThreshold: clampInt(document.getElementById("scrollCloseThreshold").value, 0, 1000, 100),
    blocklist: textToBlocklist(document.getElementById("blocklist").value),
  };
}

function clampInt(v, lo, hi, def) {
  const n = parseInt(v, 10);
  if (Number.isFinite(n)) return Math.max(lo, Math.min(hi, n));
  return def;
}

function applyEngineUI() {
  const engine = document.getElementById("engine").value;
  const isGoogle = engine === "google";
  document.getElementById("llmFields").classList.toggle("hidden", isGoogle);
  document.getElementById("engineHint").classList.toggle("hidden", !isGoogle);
}

async function save() {
  const cfg = readForm();
  const ok = await syncSet(cfg);
  if (ok) {
    setStatus("saveStatus", "已保存（已同步到云端）", "ok");
  } else {
    setStatus("saveStatus", "保存失败（同步不可用）", "err");
  }
  setTimeout(() => setStatus("saveStatus", "", ""), 2500);
}

function setStatus(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = "result" + (cls ? " " + cls : "");
}

async function testConnection() {
  setStatus("testResult", "测试中…", "");
  // 用 overrideConfig 把表单值随消息发过去，不污染已保存的配置；测试结果也不进缓存
  try {
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "TRANSLATE_ONE", text: "Hello, world!", overrideConfig: readForm() },
        (r) => resolve(r || { ok: false, error: "无响应" })
      );
    });
    if (resp.ok) {
      setStatus("testResult", `✓ 成功（→ ${resp.targetLang}）：${(resp.translation || "").slice(0, 60)}`, "ok");
    } else {
      setStatus("testResult", `✗ ${resp.error}`, "err");
    }
  } catch (e) {
    setStatus("testResult", `✗ ${String(e?.message || e)}`, "err");
  }
}

// —— 配置导出 ——
async function exportConfig() {
  try {
    const cfg = await chrome.storage.sync.get(SYNC_FIELDS);
    const payload = { _app: "喵喵翻译", _version: 1, _exportedAt: new Date().toISOString(), ...cfg };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meow-translate-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("backupStatus", "✓ 已导出", "ok");
    setTimeout(() => setStatus("backupStatus", "", ""), 2500);
  } catch (e) {
    setStatus("backupStatus", `✗ 导出失败：${e.message}`, "err");
  }
}

// —— 配置导入 ——
function triggerImport() {
  document.getElementById("importFile").click();
}

async function handleImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    if (obj?._app !== "喵喵翻译") {
      const ok = confirm("这不像是喵喵翻译导出的配置文件。仍要导入吗？\n\n（仅会写入识别的字段，未知字段会被忽略）");
      if (!ok) return;
    }
    // 白名单过滤 + 类型校验
    const filtered = {};
    for (const k of SYNC_FIELDS) {
      if (obj[k] === undefined) continue;
      if (k === "blocklist") {
        if (Array.isArray(obj[k])) filtered[k] = obj[k].map(String).map(s => s.trim().toLowerCase()).filter(Boolean);
      } else if (k === "disableThinking") {
        filtered[k] = !!obj[k];
      } else if (k === "scrollCloseThreshold") {
        filtered[k] = clampInt(obj[k], 0, 1000, 100);
      } else if (typeof obj[k] === "string") {
        filtered[k] = obj[k];
      }
    }
    if (!Object.keys(filtered).length) {
      setStatus("backupStatus", "✗ 文件中没有可识别的配置字段", "err");
      return;
    }
    await chrome.storage.sync.set(filtered);
    await load();
    setStatus("backupStatus", `✓ 已导入并应用（${Object.keys(filtered).length} 个字段）`, "ok");
    setTimeout(() => setStatus("backupStatus", "", ""), 3500);
  } catch (err) {
    setStatus("backupStatus", `✗ 导入失败：${err.message}`, "err");
  } finally {
    e.target.value = "";   // 允许再次选同一文件
  }
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  document.getElementById("saveBtn").addEventListener("click", save);
  document.getElementById("testBtn").addEventListener("click", testConnection);
  document.getElementById("engine").addEventListener("change", applyEngineUI);
  document.getElementById("exportBtn").addEventListener("click", exportConfig);
  document.getElementById("importBtn").addEventListener("click", triggerImport);
  document.getElementById("importFile").addEventListener("change", handleImportFile);
  document.getElementById("editShortcutsBtn").addEventListener("click", () => {
    // Chrome 不允许 chrome.tabs.update 直接打开 chrome:// 链接，
    // 但 chrome.tabs.create 是允许的（chrome://extensions/shortcuts 是常用的允许目标）
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });
});
