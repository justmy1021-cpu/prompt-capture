import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

test("工具栏读取、合并并监听 Chrome 运行期共享会话", () => {
  assert.match(appSource, /from "\.\/active-session\.js"/);
  assert.match(appSource, /async function readActiveSession\(\)/);
  assert.match(appSource, /async function saveActiveSessionPatch\(patch\)/);
  assert.match(appSource, /storage\.session\.get\(ACTIVE_SESSION_KEY\)/);
  assert.match(appSource, /mergeActiveSession\(current, patch\)/);
  assert.match(appSource, /storage\.session\.set\(\{ \[ACTIVE_SESSION_KEY\]: next \}\)/);
  assert.match(appSource, /area === "session"/);
  assert.match(appSource, /changes\[ACTIVE_SESSION_KEY\]\?\.newValue/);
});

test("共享会话可恢复生成、结果、错误、历史和设置页面", () => {
  assert.match(appSource, /const applyActiveSession = \(raw\) => \{/);
  assert.match(appSource, /normalizeActiveSession\(raw\)/);
  for (const phase of ["generating", "result", "error", "history", "settings"]) {
    assert.match(appSource, new RegExp(`phase === "${phase}"`));
  }
  assert.match(appSource, /setCapture\(session\.record \|\| session\.capture\)/);
  assert.match(appSource, /setRetryCapture\(session\.capture\)/);
  assert.match(appSource, /setErrorMessage\(session\.error/);
  assert.match(appSource, /setActivePrompt\(session\.activePrompt\)/);
});

test("导航、返回和 Prompt 类型切换都会更新共享会话", () => {
  assert.match(appSource, /openScreen[\s\S]*?saveActiveSessionPatch\(\{ phase: next, previousPhase/);
  assert.match(appSource, /returnFromSubpage[\s\S]*?saveActiveSessionPatch\(\{ phase: next, previousPhase: next \}\)/);
  assert.match(appSource, /selectActivePrompt[\s\S]*?saveActiveSessionPatch\(\{ activePrompt: next \}\)/);
  assert.match(appSource, /setActivePrompt=\{selectActivePrompt\}/);
});
