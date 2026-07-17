import test from "node:test";
import assert from "node:assert/strict";

function eventSlot() {
  let listener = null;
  return {
    api: { addListener(callback) { listener = callback; } },
    emit(...args) { return listener?.(...args); },
  };
}

async function waitForMessages(messages, expectedCount) {
  const deadline = Date.now() + 1000;
  while (messages.length < expectedCount && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(messages.length, expectedCount);
}

test("后台在多个窗口中始终只显示最后聚焦窗口的活动普通网页", async () => {
  const actionClicked = eventSlot();
  const command = eventSlot();
  const runtimeMessage = eventSlot();
  const tabActivated = eventSlot();
  const tabUpdated = eventSlot();
  const tabRemoved = eventSlot();
  const windowFocused = eventSlot();
  const localStore = {};
  const messages = [];
  let lastFocusedWindowId = 10;
  const tabs = [
    { id: 1, windowId: 10, active: true, url: "https://one.example" },
    { id: 2, windowId: 10, active: false, url: "https://two.example" },
    { id: 3, windowId: 20, active: true, url: "https://three.example" },
    { id: 4, windowId: 20, active: false, url: "chrome://settings" },
  ];

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
      session: { async get() { return {}; }, async set() {} },
    },
    tabs: {
      onActivated: tabActivated.api,
      onUpdated: tabUpdated.api,
      onRemoved: tabRemoved.api,
      async query() { return tabs.map((tab) => ({ ...tab })); },
      async sendMessage(tabId, message) {
        messages.push({ tabId, ...message });
        return { ok: true };
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: windowFocused.api,
      async getLastFocused() { return { id: lastFocusedWindowId }; },
    },
  };

  try {
    await import(`../dist/background.js?routing-test=${Date.now()}`);

    actionClicked.emit();
    await waitForMessages(messages, 3);
    assert.deepEqual(messages.slice(-3), [
      { tabId: 1, type: "prompt-capture/show-toolbar-v9", position: null },
      { tabId: 2, type: "prompt-capture/hide-toolbar-v9" },
      { tabId: 3, type: "prompt-capture/hide-toolbar-v9" },
    ]);

    lastFocusedWindowId = 20;
    windowFocused.emit(20);
    await waitForMessages(messages, 6);
    assert.deepEqual(messages.slice(-3), [
      { tabId: 1, type: "prompt-capture/hide-toolbar-v9" },
      { tabId: 2, type: "prompt-capture/hide-toolbar-v9" },
      { tabId: 3, type: "prompt-capture/show-toolbar-v9", position: null },
    ]);

    windowFocused.emit(-1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(messages.length, 6, "切换到其他 App 不应改变最后的 Chrome 显示目标");

    tabs[2].active = false;
    tabs[3].active = true;
    tabActivated.emit({ tabId: 4, windowId: 20 });
    await waitForMessages(messages, 9);
    assert.ok(messages.slice(-3).every((message) => message.type === "prompt-capture/hide-toolbar-v9"));

    tabs[2].active = true;
    tabs[3].active = false;
    tabActivated.emit({ tabId: 3, windowId: 20 });
    await waitForMessages(messages, 12);
    assert.equal(messages.at(-1).type, "prompt-capture/show-toolbar-v9");
    assert.equal(messages.at(-1).tabId, 3);
  } finally {
    delete globalThis.chrome;
  }
});
