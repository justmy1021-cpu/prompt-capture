# Prompt Capture Single Global Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在整个 Chrome 中只显示一个逻辑工具栏，并让位置、分析进度、结果和导航状态跨标签页统一。

**Architecture:** 后台串行计算最后聚焦 Chrome 窗口的活动标签页，向唯一目标发送显示消息并隐藏其他页面。位置保存在 `chrome.storage.local`，分析会话保存在 `chrome.storage.session`；后台负责生成生命周期，React 工具栏负责读取和呈现共享会话。

**Tech Stack:** Chrome Extension Manifest V3、JavaScript ES modules、React 19、Vite 6、Node.js `node:test`

## Global Constraints

- 整个 Chrome 同一时间最多显示一个工具栏。
- 忽略 `WINDOW_ID_NONE`，保留最后聚焦 Chrome 窗口。
- 全局启停与位置跨浏览器重启保留；临时分析会话仅在当前 Chrome 运行期间保留。
- 切换目标时取消未确认选择，但不取消已提交模型请求。
- 保持版本号 `0.2.5`、现有视觉样式、模型协议和历史结构。
- 消息通道升级到 `v9`，内容脚本版本升级到 `2026-07-17-single-global-toolbar-v17`。
- 严格串行执行任务；每项测试通过并提交后才开始下一项。

---

### Task 1: 单实例目标与会话纯函数

**Files:**
- Modify: `public/toolbar-state.js`
- Modify: `tests/toolbar-state.test.mjs`
- Create: `src/active-session.js`
- Create: `tests/active-session.test.mjs`
- Modify: `vite.config.mjs`

**Interfaces:**
- Produces: `TOOLBAR_POSITION_KEY`、`resolveToolbarTargetTabId(tabs, focusedWindowId)`、`ACTIVE_SESSION_KEY`、`DEFAULT_ACTIVE_SESSION`、`normalizeActiveSession(raw)`、`mergeActiveSession(current, patch, updatedAt)`、`compactActiveSession(session)`。

- [ ] **Step 1: 写入失败测试**

扩充目标测试，覆盖同窗口活动页、跨窗口、系统页面和空目标；新增会话测试，覆盖 phase、Prompt 类型、合并时间与移除截图降级。

```js
assert.equal(resolveToolbarTargetTabId(tabs, 20), 3);
assert.equal(resolveToolbarTargetTabId(tabs, 10), 1);
assert.equal(resolveToolbarTargetTabId(tabs, 30), null);
assert.equal(ACTIVE_SESSION_KEY, "promptCaptureActiveSession");
assert.equal(normalizeActiveSession({ phase: "unknown" }).phase, "idle");
assert.equal(mergeActiveSession({}, { phase: "generating" }, 100).updatedAt, 100);
assert.equal(compactActiveSession({ capture: { screenshotDataUrl: "data:image/png;base64,x" } }).capture.screenshotDataUrl, "");
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/toolbar-state.test.mjs tests/active-session.test.mjs`

Expected: FAIL，缺少目标和会话接口。

- [ ] **Step 3: 实现纯函数并配置构建输出**

`resolveToolbarTargetTabId` 只返回指定窗口中 `active === true`、URL 支持且具有数字 ID 的标签页。会话仅接受约定 phase 和 `image|style|layout`，其他值回退默认；`compactActiveSession` 清空 capture、record 中的截图字段但保留元数据。

在 Vite 插件中把 `src/active-session.js` 作为根级 `active-session.js` 输出，供后台 service worker 导入。

- [ ] **Step 4: 运行测试并提交**

Run: `node --test tests/toolbar-state.test.mjs tests/active-session.test.mjs`

Expected: 全部 PASS。

```bash
git add public/toolbar-state.js src/active-session.js tests/toolbar-state.test.mjs tests/active-session.test.mjs vite.config.mjs
git commit -m "Add single toolbar state helpers"
```

---

### Task 2: 唯一活动标签页显示与全局位置

**Files:**
- Modify: `public/background.js`
- Modify: `public/content-script.js`
- Modify: `tests/content-script-contract.test.mjs`
- Create: `tests/single-toolbar-contract.test.mjs`

**Interfaces:**
- Consumes: Task 1 的目标和位置接口。
- Produces: `QUERY_TOOLBAR_VISIBILITY` 消息、`queueToolbarReconcile()`、`reconcileToolbarVisibility()`、`getFocusedWindowId()`、带 `position` 的显示响应。

- [ ] **Step 1: 写入失败契约测试**

测试必须断言：

```js
assert.match(backgroundSource, /chrome\.tabs\.onActivated\.addListener/);
assert.match(backgroundSource, /chrome\.windows\.onFocusChanged\.addListener/);
assert.match(backgroundSource, /chrome\.tabs\.onUpdated\.addListener/);
assert.match(backgroundSource, /chrome\.tabs\.onRemoved\.addListener/);
assert.match(backgroundSource, /Promise\.allSettled/);
assert.match(contentSource, /MESSAGE\.QUERY_TOOLBAR_VISIBILITY/);
assert.match(contentSource, /showToolbar\(response\.position\)/);
assert.match(contentSource, /const VERSION = "2026-07-17-single-global-toolbar-v17"/);
```

共享消息断言统一升级到 `v9`，旧 `v8` 不得残留。

- [ ] **Step 2: 运行契约测试并确认失败**

Run: `node --test tests/content-script-contract.test.mjs tests/single-toolbar-contract.test.mjs`

Expected: FAIL，缺少焦点监听和查询消息。

- [ ] **Step 3: 实现后台串行目标重算**

后台保存最后有效的 `focusedWindowId`，通过单一 Promise 队列执行重算。开启时只显示目标标签页；关闭或目标不支持时全部隐藏。窗口焦点为 `chrome.windows.WINDOW_ID_NONE` 时不修改最后窗口。显示消息附带 `promptCaptureToolbarPosition`。

内容脚本启动查询后台，不再读取 enabled 后自行显示。`showToolbar(position)` 在设置 `display: block` 前调用 `applyToolbarPosition(position)`；隐藏继续调用 `clearSelection(true)`。

- [ ] **Step 4: 运行测试并提交**

Run: `node --test tests/toolbar-state.test.mjs tests/content-script-contract.test.mjs tests/single-toolbar-contract.test.mjs tests/navigation-cancel-contract.test.mjs`

Expected: 全部 PASS。

```bash
git add public/background.js public/content-script.js tests/content-script-contract.test.mjs tests/single-toolbar-contract.test.mjs
git commit -m "Show toolbar only on focused tab"
```

---

### Task 3: 后台全局分析会话

**Files:**
- Modify: `public/background.js`
- Create: `tests/generation-session-contract.test.mjs`

**Interfaces:**
- Consumes: `ACTIVE_SESSION_KEY`、`normalizeActiveSession()`、`mergeActiveSession()`、`compactActiveSession()`。
- Produces: `readActiveSession()`、`writeActiveSession(patch)`、生成阶段 `generating|result|error`。

- [ ] **Step 1: 写入失败测试**

断言后台在请求模型前写入 `generating`，历史写入后写入 `result`，捕获错误时写入 `error`，并在 session 写入失败时使用 `compactActiveSession` 重试。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/generation-session-contract.test.mjs`

Expected: FAIL，缺少全局会话生命周期。

- [ ] **Step 3: 实现会话存储与生成生命周期**

`writeActiveSession` 先合并当前会话并写入 `chrome.storage.session`；若完整截图导致写入失败，则压缩会话并重试。`captureAndGenerate` 与 `generateFromCapture` 在模型请求前写入 `generating`；`generateAndStore` 保存历史后写入 `result`；调用方捕获错误后写入 `error`，同时保留可重试来源元数据。

- [ ] **Step 4: 运行测试并提交**

Run: `node --test tests/active-session.test.mjs tests/generation-session-contract.test.mjs`

Expected: 全部 PASS。

```bash
git add public/background.js tests/generation-session-contract.test.mjs
git commit -m "Persist active generation session"
```

---

### Task 4: React 工具栏恢复共享会话

**Files:**
- Modify: `src/App.jsx`
- Create: `tests/app-session-contract.test.mjs`

**Interfaces:**
- Consumes: `ACTIVE_SESSION_KEY`、`normalizeActiveSession()`、`mergeActiveSession()`。
- Produces: `readActiveSession()`、`saveActiveSessionPatch(patch)`、`applyActiveSession(raw)`、全局 Prompt 类型更新。

- [ ] **Step 1: 写入失败测试**

断言 App 读取 `chrome.storage.session`、监听 `area === "session"`、恢复 generating/result/error/history/settings、导航写入 phase/previousPhase，Prompt 类型切换写入 activePrompt。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/app-session-contract.test.mjs`

Expected: FAIL，缺少 App 会话恢复接口。

- [ ] **Step 3: 实现 App 会话同步**

App 启动时读取共享会话；会话变化时按 phase 恢复 screen、capture、retryCapture、errorMessage、previousScreen 和 activePrompt。历史、设置、返回和 Prompt 标签切换使用非阻塞 session patch。网页本地候选不写入共享会话，切换目标后恢复切换前的稳定 phase。

- [ ] **Step 4: 运行测试并提交**

Run: `node --test tests/app-session-contract.test.mjs tests/navigation-cancel-contract.test.mjs`

Expected: 全部 PASS。

```bash
git add src/App.jsx tests/app-session-contract.test.mjs
git commit -m "Sync toolbar analysis session"
```

---

### Task 5: 文档、全量构建与集成验证

**Files:**
- Modify: `README.md`
- Modify: `dist/**`

- [ ] **Step 1: 更新说明**

README 明确：整个 Chrome 只显示一个插件，切换标签页或窗口时位置、分析进度和结果继续保持。

- [ ] **Step 2: 运行全量测试与构建**

Run: `npm test && npm run build`

Expected: 全部测试 PASS，Vite 输出 `✓ built`，版本仍为 `0.2.5`，`dist/active-session.js` 存在。

- [ ] **Step 3: 执行后台集成模拟**

使用 Chrome API mock 验证两个窗口多个标签页中只有最后聚焦窗口的活动普通网页收到 `show-toolbar-v9`；其他网页收到隐藏；`WINDOW_ID_NONE` 不改变目标；切换到系统页面后全部隐藏。

- [ ] **Step 4: 检查安装包结构**

压缩 `dist/` 并确认根目录包含 manifest、background、content-script、toolbar-state、active-session；无 `.DS_Store`、`* 2.*`、重复路径或 `dist/` 前缀。

- [ ] **Step 5: 提交最终产物**

```bash
git add README.md dist
git commit -m "Build single global toolbar update"
git status -sb
```

Expected: 工作区干净，功能分支包含设计、计划、单实例显示、会话同步和生产构建提交。
