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
