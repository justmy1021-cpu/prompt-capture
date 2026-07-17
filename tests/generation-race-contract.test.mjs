import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const backgroundSource = await readFile(new URL("../public/background.js", import.meta.url), "utf8");
const contentSource = await readFile(new URL("../public/content-script.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

test("后台用生成任务 ID 原子拒绝旧任务覆盖新任务", () => {
  assert.match(backgroundSource, /const generationId = createGenerationId\(\)/);
  assert.match(backgroundSource, /async function writeActiveSession\(patch, expectedGenerationId/);
  assert.match(backgroundSource, /!isActiveGeneration\(current, expectedGenerationId\)/);
  assert.match(backgroundSource, /return \{ session: current, applied: false \}/);
  assert.match(backgroundSource, /writeActiveSession\(\{[\s\S]*?phase: "result"[\s\S]*?\}, generationId\)/);
  assert.match(backgroundSource, /stale: !resultUpdate\.applied/);
  assert.match(backgroundSource, /writeGenerationErrorSession\([\s\S]*?generationId/);
});

test("旧任务完成后内容脚本不再向旧页签发送成功或失败界面", () => {
  assert.equal((contentSource.match(/if \(response\?\.stale\)/g) || []).length, 2);
  assert.equal((contentSource.match(/syncActiveSession\(response\.session\);[\s\S]*?return;/g) || []).length, 2);
  assert.match(contentSource, /MESSAGE\.SYNC_ACTIVE_SESSION/);
  assert.match(contentSource, /showToolbar\(message\.position, message\.session\)/);
  assert.match(contentSource, /showToolbar\(response\.position, response\.session\)/);
});

test("开始新选择会终止旧结果资格，切页与取消时重新应用后台状态", () => {
  assert.match(appSource, /startCapture[\s\S]*?saveActiveSessionPatch\(\{[\s\S]*?phase: "idle"[\s\S]*?generationId: ""[\s\S]*?record: null/);
  assert.match(appSource, /message\.type === "PC_SELECTION_CANCELLED"[\s\S]*?refreshActiveSession\(\)/);
  assert.match(appSource, /message\.type === "PC_SHOW_TOOLBAR"[\s\S]*?applyActiveSession\(message\.payload\?\.session\)/);
  assert.match(appSource, /message\.type === "PC_ACTIVE_SESSION"[\s\S]*?applyActiveSession\(message\.payload\?\.session\)/);
});

test("所有会话修改通过后台队列广播到当前唯一工具栏", () => {
  assert.match(appSource, /type: SESSION_MESSAGE\.UPDATE, patch/);
  assert.match(backgroundSource, /message\.type === MESSAGE\.UPDATE_ACTIVE_SESSION/);
  assert.match(backgroundSource, /broadcastActiveSession\(next\)/);
  assert.match(backgroundSource, /type: MESSAGE\.SYNC_ACTIVE_SESSION, session/);
});

test("确认选择先锁定全局生成态，本地完成消息只应用后台会话", () => {
  const confirmIndex = appSource.indexOf("const confirmCandidate = async () =>");
  const globalGeneratingIndex = appSource.indexOf('phase: "generating"', confirmIndex);
  const hostConfirmIndex = appSource.indexOf('postToHost("PC_CONFIRM_SELECTION")', confirmIndex);
  assert.ok(confirmIndex >= 0);
  assert.ok(globalGeneratingIndex > confirmIndex);
  assert.ok(hostConfirmIndex > globalGeneratingIndex);
  assert.match(appSource, /PC_GENERATION_SUCCESS[\s\S]*?applyActiveSession\(message\.payload\?\.session\)/);
  assert.match(appSource, /PC_GENERATION_ERROR[\s\S]*?saveActiveSessionPatch\([\s\S]*?pendingGenerationIdRef\.current/);
});
