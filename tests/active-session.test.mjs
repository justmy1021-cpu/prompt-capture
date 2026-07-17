import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVE_SESSION_KEY,
  DEFAULT_ACTIVE_SESSION,
  compactActiveSession,
  mergeActiveSession,
  normalizeActiveSession,
} from "../src/active-session.js";

test("分析会话只接受约定页面与 Prompt 类型", () => {
  assert.equal(ACTIVE_SESSION_KEY, "promptCaptureActiveSession");
  assert.equal(DEFAULT_ACTIVE_SESSION.phase, "idle");
  assert.equal(normalizeActiveSession({ phase: "unknown" }).phase, "idle");
  assert.equal(normalizeActiveSession({ activePrompt: "unknown" }).activePrompt, "image");

  const session = normalizeActiveSession({
    phase: "settings",
    previousPhase: "result",
    activePrompt: "style",
    error: "连接失败",
    updatedAt: 88,
  });
  assert.equal(session.phase, "settings");
  assert.equal(session.previousPhase, "result");
  assert.equal(session.activePrompt, "style");
  assert.equal(session.error, "连接失败");
  assert.equal(session.updatedAt, 88);
});

test("会话合并使用显式时间并保留已有数据", () => {
  const current = normalizeActiveSession({ phase: "result", record: { id: "record-1" }, activePrompt: "image", updatedAt: 50 });
  const next = mergeActiveSession(current, { phase: "history", activePrompt: "layout" }, 100);
  assert.equal(next.phase, "history");
  assert.equal(next.activePrompt, "layout");
  assert.deepEqual(next.record, { id: "record-1" });
  assert.equal(next.updatedAt, 100);
});

test("紧凑会话移除截图数据但保留来源和结果元数据", () => {
  const compact = compactActiveSession({
    phase: "generating",
    capture: { screenshotDataUrl: "data:image/png;base64,capture", thumbnailDataUrl: "data:image/png;base64,thumb", source: { title: "来源" } },
    record: { id: "record-1", screenshotDataUrl: "data:image/png;base64,result", thumbnailDataUrl: "data:image/png;base64,result-thumb" },
    updatedAt: 120,
  });
  assert.equal(compact.capture.screenshotDataUrl, "");
  assert.equal(compact.capture.thumbnailDataUrl, "");
  assert.deepEqual(compact.capture.source, { title: "来源" });
  assert.equal(compact.record.id, "record-1");
  assert.equal(compact.record.screenshotDataUrl, "");
  assert.equal(compact.record.thumbnailDataUrl, "");
});
