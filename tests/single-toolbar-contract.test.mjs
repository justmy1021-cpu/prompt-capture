import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const backgroundSource = await readFile(new URL("../public/background.js", import.meta.url), "utf8");
const contentSource = await readFile(new URL("../public/content-script.js", import.meta.url), "utf8");

test("标签页、窗口、刷新和关闭都会串行重算唯一显示目标", () => {
  assert.match(backgroundSource, /chrome\.tabs\.onActivated\.addListener/);
  assert.match(backgroundSource, /chrome\.windows\.onFocusChanged\.addListener/);
  assert.match(backgroundSource, /chrome\.tabs\.onUpdated\.addListener/);
  assert.match(backgroundSource, /chrome\.tabs\.onRemoved\.addListener/);
  assert.match(backgroundSource, /queueToolbarReconcile/);
  assert.match(backgroundSource, /reconcileToolbarVisibility/);
  assert.match(backgroundSource, /WINDOW_ID_NONE/);
});

test("后台只向目标页显示并向其他普通网页隐藏", () => {
  assert.match(backgroundSource, /resolveToolbarTargetTabId\(tabs, focusedWindowId\)/);
  assert.match(backgroundSource, /tab\.id === targetTabId \? MESSAGE\.SHOW_TOOLBAR : MESSAGE\.HIDE_TOOLBAR/);
  assert.match(backgroundSource, /TOOLBAR_POSITION_KEY/);
  assert.match(backgroundSource, /position/);
});

test("内容脚本显示前应用后台返回的全局位置", () => {
  assert.match(contentSource, /showToolbar\(message\.position, message\.session\)/);
  assert.match(contentSource, /showToolbar\(response\.position, response\.session\)/);
  assert.match(contentSource, /function applyToolbarPosition\(position\)/);
  assert.match(contentSource, /applyToolbarPosition\(position\);[\s\S]*?style\.display = "block"/);
});
