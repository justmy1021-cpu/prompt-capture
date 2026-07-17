import test from "node:test";
import assert from "node:assert/strict";

import {
  TOOLBAR_POSITION_KEY,
  TOOLBAR_STATE_KEY,
  isToolbarSupportedUrl,
  nextToolbarEnabled,
  resolveToolbarTargetTabId,
} from "../public/toolbar-state.js";

test("全局工具栏状态默认关闭并按当前值反转", () => {
  assert.equal(TOOLBAR_STATE_KEY, "promptCaptureToolbarEnabled");
  assert.equal(TOOLBAR_POSITION_KEY, "promptCaptureToolbarPosition");
  assert.equal(nextToolbarEnabled(undefined), true);
  assert.equal(nextToolbarEnabled(false), true);
  assert.equal(nextToolbarEnabled(true), false);
});

test("只选择最后聚焦窗口中的活动普通网页", () => {
  const tabs = [
    { id: 1, windowId: 10, active: true, url: "https://one.example" },
    { id: 2, windowId: 10, active: false, url: "https://two.example" },
    { id: 3, windowId: 20, active: true, url: "file:///tmp/three.html" },
    { id: 4, windowId: 30, active: true, url: "chrome://extensions" },
  ];

  assert.equal(resolveToolbarTargetTabId(tabs, 20), 3);
  assert.equal(resolveToolbarTargetTabId(tabs, 10), 1);
  assert.equal(resolveToolbarTargetTabId(tabs, 30), null);
  assert.equal(resolveToolbarTargetTabId(tabs, 40), null);
});

test("只向普通网页和文件页面同步工具栏", () => {
  assert.equal(isToolbarSupportedUrl("https://example.com"), true);
  assert.equal(isToolbarSupportedUrl("http://localhost:5173"), true);
  assert.equal(isToolbarSupportedUrl("file:///tmp/example.html"), true);
  assert.equal(isToolbarSupportedUrl("chrome://extensions"), false);
  assert.equal(isToolbarSupportedUrl("chrome-extension://example/index.html"), false);
  assert.equal(isToolbarSupportedUrl(""), false);
});
