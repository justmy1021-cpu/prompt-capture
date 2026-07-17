import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const backgroundSource = await readFile(new URL("../public/background.js", import.meta.url), "utf8");

test("后台使用 session 存储维护唯一分析会话并支持截图过大降级", () => {
  assert.match(backgroundSource, /from "\.\/active-session\.js"/);
  assert.match(backgroundSource, /async function readActiveSession\(\)/);
  assert.match(backgroundSource, /async function writeActiveSession\(patch, expectedGenerationId/);
  assert.match(backgroundSource, /chrome\.storage\.session\.get\(ACTIVE_SESSION_KEY\)/);
  assert.match(backgroundSource, /chrome\.storage\.session\.set\(\{ \[ACTIVE_SESSION_KEY\]: next \}\)/);
  assert.match(backgroundSource, /compactActiveSession\(next\)/);
  assert.match(backgroundSource, /chrome\.storage\.session\.set\(\{ \[ACTIVE_SESSION_KEY\]: compact \}\)/);
});

test("模型请求前写入 generating，历史保存后写入 result", () => {
  const generatingIndex = backgroundSource.indexOf('phase: "generating"');
  const requestIndex = backgroundSource.indexOf("requestVisionModel({ settings, imageDataUrl: screenshotDataUrl })");
  const historyIndex = backgroundSource.indexOf("[STORAGE.history]");
  const resultIndex = backgroundSource.indexOf('phase: "result"');

  assert.ok(generatingIndex >= 0, "缺少 generating 会话写入");
  assert.ok(requestIndex > generatingIndex, "generating 必须先于模型请求");
  assert.ok(historyIndex >= 0, "缺少历史记录写入");
  assert.ok(resultIndex > requestIndex, "result 必须在模型请求完成后写入");
  assert.match(backgroundSource, /writeActiveSession\(\{[\s\S]*?phase: "result",[\s\S]*?record,[\s\S]*?error: ""/);
});

test("两个生成入口捕获异常后都写入可重试的 error 会话", () => {
  assert.match(backgroundSource, /captureAndGenerate[\s\S]*?catch \(error\) \{[\s\S]*?writeGenerationErrorSession/);
  assert.match(backgroundSource, /generateFromCapture[\s\S]*?catch \(error\) \{[\s\S]*?writeGenerationErrorSession/);
  assert.match(backgroundSource, /async function writeGenerationErrorSession\([\s\S]*?phase: "error"[\s\S]*?capture[\s\S]*?error:/);
});
