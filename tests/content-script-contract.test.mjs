import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const backgroundSource = await readFile(new URL("../public/background.js", import.meta.url), "utf8");
const contentSource = await readFile(new URL("../public/content-script.js", import.meta.url), "utf8");

const routedMessages = [
  "show-toolbar",
  "hide-toolbar",
  "query-toolbar-visibility",
  "disable-toolbar-globally",
  "start-shortcut",
  "capture-selection",
  "capture-and-generate",
  "generate-from-capture",
];

test("后台与内容脚本使用同一组升级消息通道", () => {
  for (const name of routedMessages) {
    const channel = `prompt-capture/${name}-v9`;
    assert.match(backgroundSource, new RegExp(channel));
    assert.match(contentSource, new RegExp(channel));
  }
  assert.doesNotMatch(backgroundSource, /prompt-capture\/.+-v8/);
  assert.doesNotMatch(contentSource, /prompt-capture\/.+-v8/);
});

test("内容脚本版本随消息通道升级，允许替换已打开页面的旧实例", () => {
  assert.match(contentSource, /const VERSION = "2026-07-17-single-global-toolbar-v17"/);
  assert.match(backgroundSource, /tabs that predate an update/);
  assert.match(backgroundSource, /chrome\.scripting\.executeScript/);
});

test("后台持久化全局状态后只显示唯一目标网页", () => {
  assert.match(backgroundSource, /TOOLBAR_STATE_KEY/);
  assert.match(backgroundSource, /chrome\.storage\.local\.set\(\{ \[TOOLBAR_STATE_KEY\]: enabled \}\)/);
  assert.match(backgroundSource, /chrome\.tabs\.query\(\{\}\)/);
  assert.match(backgroundSource, /Promise\.allSettled/);
  assert.match(backgroundSource, /resolveToolbarTargetTabId/);
});

test("内容脚本启动时查询唯一显示资格并支持明确隐藏", () => {
  assert.match(contentSource, /syncInitialToolbarVisibility\(\)/);
  assert.match(contentSource, /MESSAGE\.QUERY_TOOLBAR_VISIBILITY/);
  assert.match(contentSource, /message\.type === MESSAGE\.HIDE_TOOLBAR/);
  assert.match(contentSource, /hideToolbar\(\)/);
});

test("网页内关闭按钮请求后台全局关闭", () => {
  assert.match(contentSource, /PC_HIDE_TOOLBAR/);
  assert.match(contentSource, /MESSAGE\.DISABLE_TOOLBAR_GLOBALLY/);
  assert.match(backgroundSource, /message\.type === MESSAGE\.DISABLE_TOOLBAR_GLOBALLY/);
});

test("截图前等待两帧重绘，避免选区边框残留在预览中", () => {
  assert.match(contentSource, /requestAnimationFrame\(\(\) => window\.requestAnimationFrame\(resolve\)\)/);
  assert.match(contentSource, /await waitForCapturePaint\(\)/);
});

test("选区边框使用 border-box 与目标图片保持同宽同高", () => {
  for (const selector of ["pc-selection-box", "pc-image-outline", "pc-page-outline"]) {
    assert.match(contentSource, new RegExp(`\\.${selector} \\{[\\s\\S]*?box-sizing: border-box !important;`));
  }
});
