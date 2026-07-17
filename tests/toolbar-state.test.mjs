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
