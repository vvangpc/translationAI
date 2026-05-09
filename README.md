# 喵喵翻译 🐱

> 轻量自用 Chrome 翻译扩展 · 划词气泡 / 右键菜单
> 支持 LLM（OpenAI 兼容）与 Google 翻译双引擎，配置随 Chrome 账号同步

---

## 为什么造这个轮子

市面上的 Chrome 翻译插件都太复杂 —— 词典、生词本、付费墙、十几个标签页的设置。这个扩展只做两件事：

1. **划词气泡翻译**：选中文字 → 弹出小猫图标 → 点击或 `Alt+T` → 气泡显示译文
2. **右键菜单翻译**：右键选中文字 → "翻译: ..." 一键触发

设计哲学：能少做就少做，能用 Chrome 自带能力就别自己实现。

---

## 功能特点

### 翻译引擎

- **LLM (OpenAI 兼容)**：DeepSeek / 智谱 / OpenAI / 任意中转 —— 自填 `base_url` + `api_key` + `model`
- **Google 翻译 (free)**：非官方端点，零配置、毫秒级响应，质量略低
- 划词气泡顶栏可一键切换引擎并立即重译当前选区

### 速度优化

- **持久化 LRU 缓存**：1000 条译文存 `chrome.storage.local`，重访秒返
- **DeepSeek 思考模式可关**：V3.1+ 默认开思考会拖慢翻译，扩展默认关闭
- **fetch 30s 超时**：请求挂死自动报错，不会无限等待

### 划词气泡交互

- **四种关闭方式**：点 X、按 ESC、点击空白处，或**滚动页面累计超过阈值**自动关闭
- 滚动关闭阈值在设置页可调（默认 100 px，0–1000 px 范围；设为 0 即禁用滚动关闭）

### 配置同步

- 9 个配置字段（API key / model / 引擎 / 黑名单 / 提示词等）走 `chrome.storage.sync`
- 在任意 Chrome 登录同 Google 账号即自动同步（前提：相同扩展 ID）
- 翻译缓存留本地（`storage.local`），不上云 —— 隐私 + 配额

### 域名黑名单

- popup 一键加入/移出当前域名（"⊘ 加入黑名单" / "✓ 移出黑名单"）
- 黑名单**只屏蔽划词图标自动弹出**，右键菜单 / 快捷键仍可用 —— 不打扰但不剥夺
- options 页支持 textarea 批量编辑（每行一域名，子域自动匹配）

### 配置导入/导出

- options 提供「📥 导出配置 JSON」「📤 导入配置 JSON」
- 用于离线备份 / 跨账号迁移 / 复盘

---

## 安装

> ⚠️ 当前未上架 Chrome 商店，需要开发者模式手动加载。

### 方式 A · git clone

```bash
git clone https://github.com/vvangpc/translationAI.git
```

### 方式 B · 下载 ZIP

GitHub 仓库右上角 → `Code` → `Download ZIP` → 解压

### 加载到 Chrome

1. 地址栏打开 `chrome://extensions/`
2. 右上角开启「**开发者模式**」
3. 点「**加载已解压的扩展程序**」→ 选解压/clone 出的目录
4. 工具栏点 🧩 → 找到「喵喵翻译」→ 📌 钉到工具栏

---

## 配置

### 首次设置 API（LLM 引擎）

点工具栏小猫 → 弹窗里点 **⚙ 设置** → 在打开的设置页填：

| 字段 | 示例 |
|---|---|
| Base URL | `https://api.deepseek.com/v1` |
| API Key | `sk-xxxx`（仅存 `chrome.storage.sync`，加密同步） |
| Model | `deepseek-chat` |

常见服务商：

| 服务商 | Base URL | Model |
|---|---|---|
| **DeepSeek**（推荐：快、便宜、国内可直连） | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Anthropic（需中转） | 对应中转 URL | `claude-3-5-sonnet` |

填完点「**测试连接**」—— 看到绿色 ✓ 就说明通了，再点「**保存**」。

> **DeepSeek 用户重要**：保持「禁用思考模式」勾选状态（默认开），单段速度会快 1.5–3 倍。

### 切到 Google 引擎（无需 key）

设置页顶部「翻译引擎」下拉切到 `Google 翻译（免费）` → 保存即可。LLM 字段会自动隐藏。

> Google 用的是 Chrome 自家翻译同款的非官方 free 端点。质量略低，并发过高会偶发 429（已自动退避重试）。

---

## 快捷键

| 键 | 动作 |
|---|---|
| `Alt+T` | 翻译选中文字 |
| `Esc` | 关闭气泡 |

修改快捷键：地址栏 `chrome://extensions/shortcuts`

---

## 跨电脑使用（配置秒同步）

> Chrome 不会自动同步开发者模式加载的扩展本身，需要每台电脑手动安装。
> 但因为 manifest.json 里固定了公钥（`key` 字段），所有设备装上后**扩展 ID 一致**，
> `chrome.storage.sync` 数据会自动跨设备同步。

**锁定的 Extension ID**：`kgdoofagfkgegohidlenppkghilmepfm`

### 多电脑流程

1. 在新电脑：`git clone https://github.com/vvangpc/translationAI.git`
2. `chrome://extensions/` → 开发者模式 → 加载已解压扩展程序 → 选目录
3. **不需要重新配置 API**：登录同一 Google 账号的 Chrome 会从 `storage.sync` 自动拉取
   - Base URL / API Key / Model / 黑名单 / 系统 Prompt 全都自动到位
   - 一般 30s–1min 内同步完成（取决于 Chrome 同步周期）

### 更新代码

```bash
git pull
```

然后到 `chrome://extensions/` 找到喵喵翻译卡片，点 ↻ 刷新按钮。

### 关于私钥（important）

- 仓库里的 `manifest.json` 只含**公钥**（`key` 字段），可以安全公开
- 配套的**私钥**保存在仓库外：`E:\translationAI-private\extension-key.pem`
- 私钥**仅用于将来打包 CRX 上架**；纯 unpacked 自用**用不到**
- 如果丢了私钥：影响仅限于「以后想上架就要换新 ID」；当前装机不受影响
- **不要把私钥提交到 git 仓库**

---

## 文件结构

```
translationAI/
├── manifest.json              # MV3 清单
├── background.js              # Service Worker：翻译引擎路由 / 缓存 / 右键菜单 / 快捷键
├── content/
│   ├── selection-bubble.js    # 划词气泡（Shadow DOM 隔离）
│   └── content.js             # 入口：选区监听 + 消息接收 + 黑名单
├── popup/
│   ├── popup.html             # 工具栏弹窗
│   ├── popup.js               # 黑名单切换
│   └── popup.css
├── options/
│   ├── options.html           # 设置页
│   ├── options.js             # 引擎 / API / 黑名单 / 导入导出
│   └── options.css
└── icons/                     # Q 版小猫头像 16/32/48/128
```

---

## 隐私

- **API Key**：存在 `chrome.storage.sync`，由 Chrome 加密同步与存储；本扩展从不上传 / 上报到任何第三方服务器
- **翻译记录**：缓存仅留本机 `chrome.storage.local`，不上云
- **黑名单 / 域名**：跟随 Chrome 同步，无外发
- **网络请求**：仅向你配置的 LLM 端点 / Google 翻译端点发起 fetch，无遥测、无 analytics

---

## 技术栈

- Manifest V3
- 原生 JavaScript（无构建步骤、无依赖）
- Shadow DOM（划词气泡样式隔离）
- chrome.storage.sync（配置）/ .local（缓存）

---

## License

MIT
