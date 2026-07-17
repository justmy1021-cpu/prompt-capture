# Prompt Capture Global Toolbar and Selection Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Prompt Capture 一次开启后在所有支持网页持续显示，并在用户进入历史或设置时取消尚未确认的采集选择。

**Architecture:** 后台使用 `chrome.storage.local` 保存全局布尔开关，并向所有支持的标签页广播明确的显示或隐藏消息；内容脚本启动时恢复该状态，网页内关闭动作统一回到后台执行全局关闭。React 工具栏在进入历史或设置前重置选择界面，并通过宿主消息让内容脚本移除网页遮罩、描边和交互锁定。

**Tech Stack:** Chrome Extension Manifest V3、JavaScript ES modules、React 19、Vite 6、Node.js `node:test`

## Global Constraints

- 全局状态键固定为 `promptCaptureToolbarEnabled`，字段不存在时按关闭处理。
- 全局关闭必须先写入存储，再广播隐藏消息。
- 系统页面或单个标签页注入失败不得阻断其他标签页。
- 历史和设置入口必须复用同一取消路径。
- 已确认并发送到模型的生成请求不在本次取消范围内。
- Manifest V3、现有权限、版本号 `0.2.5` 和模型配置数据结构保持不变。
- 消息通道从 `v7` 同步升级到 `v8`，内容脚本版本标识升级到 `2026-07-17-global-toolbar-v16`。

---

## File Map

- Create: `public/toolbar-state.js` — 保存全局状态键、状态反转和支持网址判断的纯函数。
- Create: `tests/toolbar-state.test.mjs` — 直接验证全局状态纯函数。
- Modify: `public/background.js` — 串行切换全局状态、广播显示或隐藏、处理网页内全局关闭请求。
- Modify: `public/content-script.js` — 启动时恢复状态、响应显示或隐藏、将关闭动作转为全局关闭、处理选择取消。
- Modify: `src/App.jsx` — 进入历史或设置前统一重置选择状态并通知宿主取消。
- Modify: `tests/content-script-contract.test.mjs` — 验证 `v8` 通道、全局状态恢复和广播契约。
- Create: `tests/navigation-cancel-contract.test.mjs` — 验证历史与设置复用同一取消路径。
- Modify: `README.md` — 说明一次开启、跨网页显示和全局关闭行为。
- Modify: `dist/**` — 由 `npm run build` 生成的可安装扩展产物。

---

### Task 1: 全局状态纯函数

**Files:**
- Create: `public/toolbar-state.js`
- Create: `tests/toolbar-state.test.mjs`

**Interfaces:**
- Consumes: Chrome 标签页对象的可选 `url` 字段，以及存储中的布尔值或空值。
- Produces: `TOOLBAR_STATE_KEY: string`、`nextToolbarEnabled(value): boolean`、`isToolbarSupportedUrl(url): boolean`。

- [ ] **Step 1: 写入失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  TOOLBAR_STATE_KEY,
  isToolbarSupportedUrl,
  nextToolbarEnabled,
} from "../public/toolbar-state.js";

test("全局工具栏状态默认关闭并按当前值反转", () => {
  assert.equal(TOOLBAR_STATE_KEY, "promptCaptureToolbarEnabled");
  assert.equal(nextToolbarEnabled(undefined), true);
  assert.equal(nextToolbarEnabled(false), true);
  assert.equal(nextToolbarEnabled(true), false);
});

test("只向普通网页和文件页面同步工具栏", () => {
  assert.equal(isToolbarSupportedUrl("https://example.com"), true);
  assert.equal(isToolbarSupportedUrl("http://localhost:5173"), true);
  assert.equal(isToolbarSupportedUrl("file:///tmp/example.html"), true);
  assert.equal(isToolbarSupportedUrl("chrome://extensions"), false);
  assert.equal(isToolbarSupportedUrl("chrome-extension://example/index.html"), false);
  assert.equal(isToolbarSupportedUrl(""), false);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/toolbar-state.test.mjs`

Expected: FAIL，错误包含 `Cannot find module '../public/toolbar-state.js'`。

- [ ] **Step 3: 实现最小纯函数模块**

```js
export const TOOLBAR_STATE_KEY = "promptCaptureToolbarEnabled";

export function nextToolbarEnabled(value) {
  return value !== true;
}

export function isToolbarSupportedUrl(url = "") {
  return /^(https?|file):\/\//.test(String(url));
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test tests/toolbar-state.test.mjs`

Expected: 2 tests，全部 PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add public/toolbar-state.js tests/toolbar-state.test.mjs
git commit -m "Add global toolbar state helpers"
```

---

### Task 2: 后台全局启停与页面状态恢复

**Files:**
- Modify: `public/background.js:1-105`
- Modify: `public/content-script.js:1-175`
- Modify: `tests/content-script-contract.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `TOOLBAR_STATE_KEY`、`nextToolbarEnabled()`、`isToolbarSupportedUrl()`。
- Produces: `toggleToolbarGlobally(): Promise<{ok: true, enabled: boolean}>`、`setToolbarEnabled(enabled): Promise<{ok: true, enabled: boolean}>`、消息 `SHOW_TOOLBAR`、`HIDE_TOOLBAR`、`DISABLE_TOOLBAR_GLOBALLY`。

- [ ] **Step 1: 扩充契约测试并升级消息版本断言**

将 `tests/content-script-contract.test.mjs` 中的消息列表改为：

```js
const routedMessages = [
  "show-toolbar",
  "hide-toolbar",
  "disable-toolbar-globally",
  "start-shortcut",
  "capture-selection",
  "capture-and-generate",
  "generate-from-capture",
];
```

将通道断言升级为 `v8`，并增加以下测试：

```js
test("后台持久化全局状态后向全部支持网页广播", () => {
  assert.match(backgroundSource, /TOOLBAR_STATE_KEY/);
  assert.match(backgroundSource, /chrome\.storage\.local\.set\(\{ \[TOOLBAR_STATE_KEY\]: enabled \}\)/);
  assert.match(backgroundSource, /chrome\.tabs\.query\(\{\}\)/);
  assert.match(backgroundSource, /Promise\.allSettled/);
  assert.match(backgroundSource, /enabled \? MESSAGE\.SHOW_TOOLBAR : MESSAGE\.HIDE_TOOLBAR/);
});

test("内容脚本启动时恢复全局显示状态并支持明确隐藏", () => {
  assert.match(contentSource, /const TOOLBAR_STATE_KEY = "promptCaptureToolbarEnabled"/);
  assert.match(contentSource, /syncInitialToolbarVisibility\(\)/);
  assert.match(contentSource, /message\.type === MESSAGE\.HIDE_TOOLBAR/);
  assert.match(contentSource, /hideToolbar\(\)/);
});

test("网页内关闭按钮请求后台全局关闭", () => {
  assert.match(contentSource, /PC_HIDE_TOOLBAR/);
  assert.match(contentSource, /MESSAGE\.DISABLE_TOOLBAR_GLOBALLY/);
  assert.match(backgroundSource, /message\.type === MESSAGE\.DISABLE_TOOLBAR_GLOBALLY/);
});
```

同时把内容脚本版本断言改为：

```js
assert.match(contentSource, /const VERSION = "2026-07-17-global-toolbar-v16"/);
```

- [ ] **Step 2: 运行契约测试并确认失败**

Run: `node --test tests/content-script-contract.test.mjs`

Expected: FAIL，至少包含缺少 `hide-toolbar-v8` 或全局状态恢复逻辑的断言失败。

- [ ] **Step 3: 在后台实现串行全局切换**

在 `public/background.js` 引入纯函数：

```js
import {
  TOOLBAR_STATE_KEY,
  isToolbarSupportedUrl,
  nextToolbarEnabled,
} from "./toolbar-state.js";
```

将共享消息通道统一升级到 `v8`，并增加：

```js
HIDE_TOOLBAR: "prompt-capture/hide-toolbar-v8",
DISABLE_TOOLBAR_GLOBALLY: "prompt-capture/disable-toolbar-globally-v8",
```

用串行队列替换当前只切换单标签页的 action 处理：

```js
let toolbarToggleQueue = Promise.resolve();

chrome.action.onClicked.addListener(() => {
  toolbarToggleQueue = toolbarToggleQueue.then(toggleToolbarGlobally, toggleToolbarGlobally);
});

async function toggleToolbarGlobally() {
  const stored = await chrome.storage.local.get(TOOLBAR_STATE_KEY);
  return setToolbarEnabled(nextToolbarEnabled(stored[TOOLBAR_STATE_KEY]));
}

async function setToolbarEnabled(enabled) {
  await chrome.storage.local.set({ [TOOLBAR_STATE_KEY]: enabled });
  const tabs = await chrome.tabs.query({});
  const type = enabled ? MESSAGE.SHOW_TOOLBAR : MESSAGE.HIDE_TOOLBAR;
  await Promise.allSettled(
    tabs
      .filter((tab) => tab?.id && isToolbarSupportedUrl(tab.url))
      .map((tab) => sendToContent(tab.id, { type })),
  );
  return { ok: true, enabled };
}
```

在后台消息监听中增加：

```js
if (message.type === MESSAGE.DISABLE_TOOLBAR_GLOBALLY) {
  setToolbarEnabled(false).then(sendResponse);
  return true;
}
```

删除旧的 `toggleToolbar(tab)`，并让快捷键通过 `isToolbarSupportedUrl(tab.url)` 判断页面支持性。

- [ ] **Step 4: 在内容脚本恢复状态并处理全局关闭**

把 `public/content-script.js` 的版本标识和共享消息升级到约定值，增加：

```js
const TOOLBAR_STATE_KEY = "promptCaptureToolbarEnabled";
```

消息监听增加明确隐藏：

```js
if (message.type === MESSAGE.HIDE_TOOLBAR) {
  hideToolbar();
  sendResponse({ ok: true });
  return false;
}
```

初始化末尾调用：

```js
void syncInitialToolbarVisibility();

async function syncInitialToolbarVisibility() {
  try {
    const stored = await extensionApi.storage.local.get(TOOLBAR_STATE_KEY);
    if (stored[TOOLBAR_STATE_KEY] === true) showToolbar();
  } catch {
    // 扩展上下文失效时保持隐藏。
  }
}
```

把 `PC_HIDE_TOOLBAR` 的本地隐藏改为：

```js
if (message.type === "PC_HIDE_TOOLBAR") void disableToolbarGlobally();

async function disableToolbarGlobally() {
  try {
    const response = await extensionApi.runtime.sendMessage({ type: MESSAGE.DISABLE_TOOLBAR_GLOBALLY });
    if (!response?.ok) hideToolbar();
  } catch {
    hideToolbar();
  }
}
```

- [ ] **Step 5: 运行相关测试并确认通过**

Run: `node --test tests/toolbar-state.test.mjs tests/content-script-contract.test.mjs`

Expected: Task 1 的 2 项测试和内容脚本契约测试全部 PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add public/background.js public/content-script.js tests/content-script-contract.test.mjs
git commit -m "Persist global toolbar visibility"
```

---

### Task 3: 历史与设置统一取消采集选择

**Files:**
- Modify: `src/App.jsx:280-315`
- Modify: `public/content-script.js:64-90`
- Create: `tests/navigation-cancel-contract.test.mjs`

**Interfaces:**
- Consumes: 工具栏到宿主的 `postToHost(type, payload)` 以及内容脚本现有 `clearSelection(announce)`。
- Produces: `cancelPendingSelection(): void` 和宿主消息 `PC_CANCEL_SELECTION`。

- [ ] **Step 1: 写入导航取消契约测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const contentSource = await readFile(new URL("../public/content-script.js", import.meta.url), "utf8");

test("进入历史或设置前统一重置工具栏选择状态", () => {
  assert.match(appSource, /const cancelPendingSelection = \(\) => \{[\s\S]*?setCandidate\(null\)[\s\S]*?setSelectionMode\(""\)[\s\S]*?setRetryCapture\(null\)[\s\S]*?setErrorMessage\(""\)[\s\S]*?setSelectionHint\(""\)[\s\S]*?PC_CANCEL_SELECTION[\s\S]*?\};/);
  assert.match(appSource, /const openScreen = \(next\) => \{[\s\S]*?cancelPendingSelection\(\);[\s\S]*?transitionToScreen\(next, "forward"\);/);
  assert.match(appSource, /onHistory=\{\(\) => openScreen\("history"\)\}/);
  assert.match(appSource, /onSettings=\{\(\) => openScreen\("settings"\)\}/);
});

test("宿主取消选择时移除网页选择但不反向覆盖导航页面", () => {
  assert.match(contentSource, /message\.type === "PC_CANCEL_SELECTION"\) clearSelection\(\)/);
  assert.doesNotMatch(contentSource, /message\.type === "PC_CANCEL_SELECTION"\) clearSelection\(true\)/);
  assert.match(contentSource, /if \(!selection \|\| selection\.type !== "page"\) return;/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/navigation-cancel-contract.test.mjs`

Expected: FAIL，错误指出缺少 `cancelPendingSelection` 或 `PC_CANCEL_SELECTION`。

- [ ] **Step 3: 在 React 工具栏增加统一取消方法**

在 `openScreen` 之前增加：

```js
const cancelPendingSelection = () => {
  setCandidate(null);
  setSelectionMode("");
  setRetryCapture(null);
  setErrorMessage("");
  setSelectionHint("");
  postToHost("PC_CANCEL_SELECTION");
};
```

修改 `openScreen`，确保取消先于页面切换：

```js
const openScreen = (next) => {
  if (next === screen) return;
  cancelPendingSelection();
  setPreviousScreen(screen);
  transitionToScreen(next, "forward");
};
```

- [ ] **Step 4: 在内容脚本处理宿主取消消息**

在 `window.addEventListener("message", ...)` 的宿主消息路由中增加：

```js
if (message.type === "PC_CANCEL_SELECTION") clearSelection();
```

必须使用默认的 `announce = false`，因为 React 工具栏已经进入导航流程；如果回发 `PC_SELECTION_CANCELLED`，延迟消息可能把历史或设置页覆盖为默认页。

保留 `captureCurrentPageCandidate()` 在异步截图返回后的有效性判断：

```js
if (!selection || selection.type !== "page") return;
```

这样用户取消“当前页面”后，已经在途的截图结果不会重新生成候选。

- [ ] **Step 5: 运行导航和既有采集测试**

Run: `node --test tests/navigation-cancel-contract.test.mjs tests/content-script-contract.test.mjs tests/capture-geometry.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add src/App.jsx public/content-script.js tests/navigation-cancel-contract.test.mjs
git commit -m "Cancel selection before navigation"
```

---

### Task 4: 文档、全量验证与生产构建

**Files:**
- Modify: `README.md`
- Modify: `dist/**`

**Interfaces:**
- Consumes: Task 1-3 完成的源代码和测试。
- Produces: 可直接加载的 `dist/` 扩展，版本仍为 `0.2.5`。

- [ ] **Step 1: 更新用户使用说明**

在 README 功能介绍中加入：

```markdown
- 点击一次扩展图标即可在所有支持的网页显示工具栏；再次点击扩展图标或关闭任一工具栏会全局隐藏。
- 进入历史或设置时，会自动取消尚未确认的图片选择、当前页面或框选截图。
```

- [ ] **Step 2: 运行完整测试**

Run: `npm test`

Expected: 现有 24 项测试与新增测试全部 PASS，失败数为 0。

- [ ] **Step 3: 生成生产构建**

Run: `npm run build`

Expected: Vite 输出 `✓ built`，`dist/manifest.json` 的版本仍为 `0.2.5`，并生成 `dist/toolbar-state.js`。

- [ ] **Step 4: 检查构建产物与重复文件**

Run:

```bash
node -e 'const m=require("./dist/manifest.json"); if(m.version!=="0.2.5") process.exit(1); console.log(`${m.name}@${m.version}`)'
find dist -type f \( -name '.DS_Store' -o -name '* 2.*' \) -print
git diff --check
```

Expected: 输出 `Prompt Capture@0.2.5`；`find` 无输出；`git diff --check` 无输出。

- [ ] **Step 5: 手动验证关键流程**

在 Chrome 加载 `dist/` 后依次验证：

1. 网页 A 开启插件，已打开网页 B 同时显示。
2. 新建网页 C、刷新网页 B、跳转网页 A 后仍显示。
3. 网页 B 点击关闭，A、B、C 全部隐藏。
4. 分别启动当前页面、选择图片、框选截图，再点击历史和设置，网页无残留遮罩且可正常滚动点击。
5. Chrome 系统页面不显示工具栏，也不影响普通网页。

- [ ] **Step 6: 提交文档与构建产物**

```bash
git add README.md dist
git commit -m "Build global toolbar update"
```

- [ ] **Step 7: 最终检查分支状态**

Run:

```bash
git status -sb
git log --oneline --decorate -6
```

Expected: 工作区无未提交修改；当前分支包含设计文档、状态模块、全局显示、导航取消和生产构建提交。
