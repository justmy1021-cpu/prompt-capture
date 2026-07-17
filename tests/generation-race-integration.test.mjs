import test from "node:test";
import assert from "node:assert/strict";

function eventSlot() {
  let listener = null;
  return {
    api: { addListener(callback) { listener = callback; } },
    emit(...args) { return listener?.(...args); },
  };
}

function visionResponse(label) {
  const content = JSON.stringify({
    schema_version: "2.0",
    source_type: "ui_page",
    source_summary: `${label}摘要`,
    image: { final_prompt: `${label}图片` },
    style: { final_prompt: `${label}风格` },
    layout: { final_prompt: `${label}布局` },
  });
  return {
    ok: true,
    status: 200,
    async json() { return { choices: [{ message: { content } }] }; },
    async text() { return ""; },
  };
}

async function waitUntil(check) {
  const deadline = Date.now() + 1000;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(check(), true);
}

test("较早分析后完成时只写历史，不覆盖较新的全局分析状态", async () => {
  const actionClicked = eventSlot();
  const command = eventSlot();
  const runtimeMessage = eventSlot();
  const tabActivated = eventSlot();
  const tabUpdated = eventSlot();
  const tabRemoved = eventSlot();
  const windowFocused = eventSlot();
  const pendingFetches = [];
  const localStore = {
    promptCaptureToolbarEnabled: true,
    promptCaptureSettings: {
      provider: "dashscope",
      modelId: "qwen3-vl-flash",
      apiKey: "test-key",
      endpoint: "https://model.example/chat/completions",
      apiTestStatus: "success",
      language: "zh",
    },
    promptCaptureHistory: [],
  };
  const sessionStore = {};
  const tab = { id: 1, windowId: 10, active: true, url: "https://page.example", title: "测试页面" };

  globalThis.chrome = {
    action: { onClicked: actionClicked.api },
    commands: { onCommand: command.api },
    runtime: { onMessage: runtimeMessage.api },
    scripting: { async executeScript() {} },
    storage: {
      local: {
        async get(keys) {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.map((key) => [key, localStore[key]]));
        },
        async set(values) { Object.assign(localStore, values); },
      },
      session: {
        async get(key) { return { [key]: sessionStore[key] }; },
        async set(values) { Object.assign(sessionStore, values); },
      },
    },
    tabs: {
      onActivated: tabActivated.api,
      onUpdated: tabUpdated.api,
      onRemoved: tabRemoved.api,
      async query() { return [{ ...tab }]; },
      async sendMessage() { return { ok: true }; },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: windowFocused.api,
      async getLastFocused() { return { id: 10 }; },
    },
  };
  globalThis.fetch = () => new Promise((resolve) => pendingFetches.push(resolve));

  const dispatch = (capture) => new Promise((resolve) => {
    const keepsChannelOpen = runtimeMessage.emit(
      { type: "prompt-capture/generate-from-capture-v9", capture },
      { tab },
      resolve,
    );
    assert.equal(keepsChannelOpen, true);
  });

  try {
    await import(`../dist/background.js?generation-race-test=${Date.now()}`);
    const first = dispatch({
      screenshotDataUrl: "data:image/png;base64,first",
      selectionType: "image",
      source: { title: "第一张图", url: tab.url },
    });
    await waitUntil(() => pendingFetches.length === 1);

    const second = dispatch({
      screenshotDataUrl: "data:image/png;base64,second",
      selectionType: "image",
      source: { title: "第二张图", url: tab.url },
    });
    await waitUntil(() => pendingFetches.length === 2);

    pendingFetches[0](visionResponse("旧任务"));
    const firstResult = await first;
    assert.equal(firstResult.ok, true);
    assert.equal(firstResult.stale, true);
    assert.equal(sessionStore.promptCaptureActiveSession.phase, "generating");
    assert.equal(sessionStore.promptCaptureActiveSession.capture.source.title, "第二张图");

    pendingFetches[1](visionResponse("新任务"));
    const secondResult = await second;
    assert.equal(secondResult.ok, true);
    assert.equal(secondResult.stale, false);
    assert.equal(sessionStore.promptCaptureActiveSession.phase, "result");
    assert.equal(sessionStore.promptCaptureActiveSession.record.prompts.image, "新任务图片");
    assert.equal(localStore.promptCaptureHistory.length, 2);
  } finally {
    delete globalThis.chrome;
    delete globalThis.fetch;
  }
});
