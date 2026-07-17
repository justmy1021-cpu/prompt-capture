import {
  VISION_PROMPT_SYSTEM_MESSAGE,
  buildVisionPromptInstruction,
  parseVisionPromptResponse,
} from "./prompt-generation.js";
import {
  isModelSettingsReady,
  normalizeModelSettings,
  validateModelSettings,
} from "./model-providers.js";
import { resolveCropRect } from "./capture-geometry.js";
import {
  ACTIVE_SESSION_KEY,
  compactActiveSession,
  createGenerationId,
  isActiveGeneration,
  mergeActiveSession,
  normalizeActiveSession,
} from "./active-session.js";
import {
  TOOLBAR_POSITION_KEY,
  TOOLBAR_STATE_KEY,
  isToolbarSupportedUrl,
  nextToolbarEnabled,
  resolveToolbarTargetTabId,
} from "./toolbar-state.js";

const MESSAGE = {
  SHOW_TOOLBAR: "prompt-capture/show-toolbar-v9",
  HIDE_TOOLBAR: "prompt-capture/hide-toolbar-v9",
  QUERY_TOOLBAR_VISIBILITY: "prompt-capture/query-toolbar-visibility-v9",
  SYNC_ACTIVE_SESSION: "prompt-capture/sync-active-session-v9",
  DISABLE_TOOLBAR_GLOBALLY: "prompt-capture/disable-toolbar-globally-v9",
  START_SHORTCUT: "prompt-capture/start-shortcut-v9",
  CAPTURE_SELECTION: "prompt-capture/capture-selection-v9",
  CAPTURE_AND_GENERATE: "prompt-capture/capture-and-generate-v9",
  GENERATE_FROM_CAPTURE: "prompt-capture/generate-from-capture-v9",
  GET_ACTIVE_SESSION: "prompt-capture/get-active-session-v1",
  UPDATE_ACTIVE_SESSION: "prompt-capture/update-active-session-v1",
  TEST_MODEL: "prompt-capture/test-model",
  COPY_TEXT: "prompt-capture/copy-text",
  OFFSCREEN_COPY_TEXT: "prompt-capture/offscreen-copy-text",
  COPY_TEXT_ON_PAGE: "prompt-capture/copy-text-on-page",
};

const STORAGE = {
  history: "promptCaptureHistory",
  settings: "promptCaptureSettings",
};

let toolbarToggleQueue = Promise.resolve();
let toolbarReconcileQueue = Promise.resolve();
let activeSessionWriteQueue = Promise.resolve();
let historyWriteQueue = Promise.resolve();
let focusedWindowId = null;

chrome.action.onClicked.addListener(() => {
  toolbarToggleQueue = toolbarToggleQueue.then(toggleToolbarGlobally, toggleToolbarGlobally);
});

chrome.tabs.onActivated.addListener(() => {
  void queueToolbarReconcile();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  focusedWindowId = windowId;
  void queueToolbarReconcile();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab?.active && (changeInfo.status === "complete" || typeof changeInfo.url === "string")) {
    void queueToolbarReconcile();
  }
});

chrome.tabs.onRemoved.addListener(() => {
  void queueToolbarReconcile();
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "start-selection") return;
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.id) startShortcut(tab).catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return false;

  if (message.type === MESSAGE.QUERY_TOOLBAR_VISIBILITY) {
    getToolbarVisibilityForTab(sender.tab).then(sendResponse);
    return true;
  }

  if (message.type === MESSAGE.GET_ACTIVE_SESSION) {
    readActiveSession().then(
      (session) => sendResponse({ ok: true, session }),
      (error) => sendResponse({ ok: false, error: error?.message || "会话读取失败" }),
    );
    return true;
  }

  if (message.type === MESSAGE.UPDATE_ACTIVE_SESSION) {
    writeActiveSession(message.patch, message.expectedGenerationId).then(
      (result) => sendResponse({ ok: true, session: result.session, applied: result.applied }),
      (error) => sendResponse({ ok: false, error: error?.message || "会话更新失败" }),
    );
    return true;
  }

  if (message.type === MESSAGE.DISABLE_TOOLBAR_GLOBALLY) {
    setToolbarEnabled(false).then(sendResponse);
    return true;
  }

  if (message.type === MESSAGE.CAPTURE_AND_GENERATE) {
    captureAndGenerate(message.selection, sender.tab).then(sendResponse);
    return true;
  }

  if (message.type === MESSAGE.CAPTURE_SELECTION) {
    captureSelection(message.selection, sender.tab).then(sendResponse);
    return true;
  }

  if (message.type === MESSAGE.GENERATE_FROM_CAPTURE) {
    generateFromCapture(message.capture, sender.tab).then(sendResponse);
    return true;
  }

  if (message.type === MESSAGE.TEST_MODEL) {
    testModel(message.settings).then(sendResponse);
    return true;
  }

  if (message.type === MESSAGE.COPY_TEXT) {
    copyText(message.text, sender.tab).then(sendResponse);
    return true;
  }

  return false;
});

async function toggleToolbarGlobally() {
  const stored = await chrome.storage.local.get(TOOLBAR_STATE_KEY);
  return setToolbarEnabled(nextToolbarEnabled(stored[TOOLBAR_STATE_KEY]));
}

async function setToolbarEnabled(enabled) {
  await chrome.storage.local.set({ [TOOLBAR_STATE_KEY]: enabled });
  await queueToolbarReconcile();
  return { ok: true, enabled };
}

async function startShortcut(tab) {
  if (!isToolbarSupportedUrl(tab?.url)) return { ok: false, error: "当前页面暂不支持采集" };
  if (Number.isInteger(tab.windowId)) focusedWindowId = tab.windowId;
  await chrome.storage.local.set({ [TOOLBAR_STATE_KEY]: true });
  await queueToolbarReconcile();
  return sendToContent(tab.id, { type: MESSAGE.START_SHORTCUT });
}

function queueToolbarReconcile() {
  toolbarReconcileQueue = toolbarReconcileQueue.then(reconcileToolbarVisibility, reconcileToolbarVisibility);
  return toolbarReconcileQueue;
}

async function getFocusedWindowId() {
  if (Number.isInteger(focusedWindowId)) return focusedWindowId;
  try {
    const focusedWindow = await chrome.windows.getLastFocused();
    if (Number.isInteger(focusedWindow?.id)) focusedWindowId = focusedWindow.id;
  } catch {
    // 浏览器正在关闭或窗口尚未就绪时暂不选择目标页。
  }
  return focusedWindowId;
}

async function readToolbarSnapshot() {
  const [stored, tabs, focusedWindowId, session] = await Promise.all([
    chrome.storage.local.get([TOOLBAR_STATE_KEY, TOOLBAR_POSITION_KEY]),
    chrome.tabs.query({}),
    getFocusedWindowId(),
    readActiveSession(),
  ]);
  const enabled = stored[TOOLBAR_STATE_KEY] === true;
  const targetTabId = enabled ? resolveToolbarTargetTabId(tabs, focusedWindowId) : null;
  return {
    enabled,
    tabs,
    targetTabId,
    position: stored[TOOLBAR_POSITION_KEY] || null,
    session,
  };
}

async function getToolbarVisibilityForTab(tab) {
  const { enabled, targetTabId, position, session } = await readToolbarSnapshot();
  return {
    ok: true,
    enabled,
    visible: enabled && tab?.id === targetTabId,
    position,
    session,
  };
}

async function reconcileToolbarVisibility() {
  const { tabs, targetTabId, position, session } = await readToolbarSnapshot();
  await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab?.id) && isToolbarSupportedUrl(tab.url))
      .map((tab) => {
        const type = tab.id === targetTabId ? MESSAGE.SHOW_TOOLBAR : MESSAGE.HIDE_TOOLBAR;
        return sendToContent(tab.id, type === MESSAGE.SHOW_TOOLBAR ? { type, position, session } : { type });
      }),
  );
  return { ok: true, targetTabId };
}

async function sendToContent(tabId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    if (response?.ok) return response;
  } catch {
    // Newly opened tabs and tabs that predate an update can miss the content script.
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content-script.js"] });
    const response = await chrome.tabs.sendMessage(tabId, message);
    return response || { ok: false, error: "TOOLBAR_NO_RESPONSE" };
  } catch (error) {
    return { ok: false, error: error?.message || "TOOLBAR_INJECTION_FAILED" };
  }
}

async function copyText(value, tab) {
  const text = String(value || "");
  if (!text) return { ok: false, error: "没有可复制的提示词" };
  try {
    const offscreenUrl = chrome.runtime.getURL("offscreen.html");
    let exists = false;
    if (chrome.offscreen.hasDocument) {
      exists = await chrome.offscreen.hasDocument();
    } else if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [offscreenUrl] });
      exists = contexts.length > 0;
    }
    if (!exists) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.CLIPBOARD],
        justification: "将用户点击复制的提示词写入系统剪贴板",
      });
    }
    let response = null;
    for (let attempt = 0; attempt < 3 && !response?.ok; attempt += 1) {
      try {
        response = await chrome.runtime.sendMessage({ type: MESSAGE.OFFSCREEN_COPY_TEXT, text });
      } catch (error) {
        response = { ok: false, error: error?.message || "剪贴板通道未就绪" };
      }
      if (!response?.ok && attempt < 2) await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (response?.ok) return response;
    if (tab?.id) {
      try {
        const fallback = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.COPY_TEXT_ON_PAGE, text });
        if (fallback?.ok) return fallback;
      } catch {
        // 页面复制不可用时返回离屏通道的原始错误。
      }
    }
    return { ok: false, error: response?.error || "复制失败" };
  } catch (error) {
    return { ok: false, error: error?.message || "复制失败" };
  }
}

async function captureAndGenerate(selection, tab) {
  if (!tab?.windowId || !selection?.width || !selection?.height) {
    return { ok: false, error: "截图区域无效" };
  }

  let screenshotDataUrl = "";
  try {
    const settingsPayload = await chrome.storage.local.get(STORAGE.settings);
    const settings = normalizeSettings(settingsPayload[STORAGE.settings]);
    if (!isSettingsComplete(settings)) {
      return { ok: false, error: "请完成模型设置并通过连接测试" };
    }

    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    screenshotDataUrl = await cropScreenshot(screenshot, selection);
    return await generateAndStore({ settings, screenshotDataUrl, selection, tab });
  } catch (error) {
    const message = normalizeError(error?.message || "Prompt 生成失败");
    await writeGenerationErrorSession({ screenshotDataUrl, selection, tab, error: message }).catch(() => {});
    return { ok: false, error: message, screenshotDataUrl };
  }
}

async function captureSelection(selection, tab) {
  if (!tab?.windowId || !selection?.width || !selection?.height) {
    return { ok: false, error: "截图区域无效" };
  }
  try {
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const screenshotDataUrl = selection.type === "page" ? screenshot : await cropScreenshot(screenshot, selection);
    return { ok: true, screenshotDataUrl };
  } catch (error) {
    return { ok: false, error: normalizeError(error?.message || "截图失败"), screenshotDataUrl: "" };
  }
}

async function generateFromCapture(capture, tab) {
  const screenshotDataUrl = capture?.screenshotDataUrl || "";
  if (!screenshotDataUrl.startsWith("data:image/")) return { ok: false, error: "原截图不可用，请重新选择后生成。", screenshotDataUrl: "" };
  try {
    const settingsPayload = await chrome.storage.local.get(STORAGE.settings);
    const settings = normalizeSettings(settingsPayload[STORAGE.settings]);
    if (!isSettingsComplete(settings)) return { ok: false, error: "请完成模型设置并通过连接测试", screenshotDataUrl };
    return await generateAndStore({
      settings,
      screenshotDataUrl,
      selection: {
        type: capture.selectionType || "region",
        title: capture.source?.title || tab?.title || "来源网页标题",
        url: capture.source?.url || tab?.url || "",
      },
      tab,
    });
  } catch (error) {
    const message = normalizeError(error?.message || "Prompt 生成失败");
    await writeGenerationErrorSession({ screenshotDataUrl, selection: capture, tab, error: message }).catch(() => {});
    return { ok: false, error: message, screenshotDataUrl };
  }
}

async function generateAndStore({ settings, screenshotDataUrl, selection, tab }) {
  const generationId = createGenerationId();
  const sessionCapture = createSessionCapture({ screenshotDataUrl, selection, tab });
  let generationStarted = false;
  try {
    await writeActiveSession({
      phase: "generating",
      previousPhase: "generating",
      capture: sessionCapture,
      record: null,
      error: "",
      generationId,
    });
    generationStarted = true;
    const { prompts, promptMeta } = await requestVisionModel({ settings, imageDataUrl: screenshotDataUrl });
    const createdAt = new Date().toISOString();
    const record = {
      id: `capture-${generationId}`,
      createdAt,
      time: formatTime(createdAt),
      selectionType: selection.type || "region",
      screenshotDataUrl,
      thumbnailDataUrl: screenshotDataUrl,
      source: { title: selection.title || tab?.title || "来源网页标题", url: selection.url || tab?.url || "" },
      language: settings.language,
      provider: settings.provider,
      modelId: settings.modelId,
      prompts,
      promptMeta,
    };
    await prependHistoryRecord(record);
    const resultUpdate = await writeActiveSession({
      phase: "result",
      previousPhase: "result",
      capture: sessionCapture,
      record,
      error: "",
      generationId,
    }, generationId);
    return { ok: true, record, stale: !resultUpdate.applied, session: resultUpdate.session };
  } catch (error) {
    const message = normalizeError(error?.message || "Prompt 生成失败");
    const errorUpdate = generationStarted
      ? await writeGenerationErrorSession({ screenshotDataUrl, selection, tab, error: message, generationId }).catch(() => null)
      : null;
    return {
      ok: false,
      error: message,
      screenshotDataUrl,
      stale: errorUpdate ? !errorUpdate.applied : false,
      session: errorUpdate?.session || null,
    };
  }
}

function prependHistoryRecord(record) {
  const commit = async () => {
    const historyPayload = await chrome.storage.local.get(STORAGE.history);
    const history = Array.isArray(historyPayload[STORAGE.history]) ? historyPayload[STORAGE.history] : [];
    await chrome.storage.local.set({ [STORAGE.history]: [record, ...history.filter((item) => item.id !== record.id)] });
  };
  historyWriteQueue = historyWriteQueue.then(commit, commit);
  return historyWriteQueue;
}

function createSessionCapture({ screenshotDataUrl = "", selection = {}, tab = {} } = {}) {
  return {
    screenshotDataUrl,
    thumbnailDataUrl: screenshotDataUrl,
    selectionType: selection.selectionType || selection.type || "region",
    source: {
      title: selection.source?.title || selection.title || tab?.title || "来源网页标题",
      url: selection.source?.url || selection.url || tab?.url || "",
    },
  };
}

async function writeGenerationErrorSession({ screenshotDataUrl, selection, tab, error, generationId }) {
  const capture = createSessionCapture({ screenshotDataUrl, selection, tab });
  return writeActiveSession({
    phase: "error",
    previousPhase: "error",
    capture,
    record: null,
    error: String(error || "生成失败，请重试"),
    generationId,
  }, generationId);
}

async function readActiveSession() {
  const stored = await chrome.storage.session.get(ACTIVE_SESSION_KEY);
  return normalizeActiveSession(stored[ACTIVE_SESSION_KEY]);
}

async function writeActiveSession(patch, expectedGenerationId = null) {
  const commit = async () => {
    const current = await readActiveSession();
    if (expectedGenerationId && !isActiveGeneration(current, expectedGenerationId)) {
      return { session: current, applied: false };
    }
    const next = mergeActiveSession(current, patch);
    try {
      await chrome.storage.session.set({ [ACTIVE_SESSION_KEY]: next });
      await broadcastActiveSession(next);
      return { session: next, applied: true };
    } catch {
      const compact = compactActiveSession(next);
      await chrome.storage.session.set({ [ACTIVE_SESSION_KEY]: compact });
      await broadcastActiveSession(compact);
      return { session: compact, applied: true };
    }
  };
  activeSessionWriteQueue = activeSessionWriteQueue.then(commit, commit);
  return activeSessionWriteQueue;
}

async function broadcastActiveSession(session) {
  const [stored, tabs, currentFocusedWindowId] = await Promise.all([
    chrome.storage.local.get(TOOLBAR_STATE_KEY),
    chrome.tabs.query({}),
    getFocusedWindowId(),
  ]);
  if (stored[TOOLBAR_STATE_KEY] !== true) return;
  const targetTabId = resolveToolbarTargetTabId(tabs, currentFocusedWindowId);
  if (targetTabId == null) return;
  await sendToContent(targetTabId, { type: MESSAGE.SYNC_ACTIVE_SESSION, session });
}

function normalizeSettings(raw = {}) {
  return normalizeModelSettings(raw);
}

function isSettingsComplete(settings) {
  return isModelSettingsReady(settings);
}

async function requestVisionModel({ settings, imageDataUrl }) {
  const response = await fetch(settings.endpoint.trim(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: settings.modelId.trim(),
      response_format: { type: "json_object" },
      temperature: 0.2,
      stream: false,
      messages: [
        {
          role: "system",
          content: VISION_PROMPT_SYSTEM_MESSAGE,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildVisionPromptInstruction(settings.language),
            },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(normalizeError(text || `模型请求失败：${response.status}`));
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型没有返回提示词");
  return parseVisionPromptResponse(content);
}

async function testModel(rawSettings) {
  const settings = normalizeSettings(rawSettings);
  const validationError = validateModelSettings(settings);
  if (validationError) return { ok: false, error: validationError };
  try {
    // Qwen-VL rejects images when either dimension is 10px or smaller.
    const testImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAA0VXHyAAABUklEQVQoFb2Rx66CQBSGpWPBQogLXbAi+AK8/3tIJCaEjRVjoUi5nxnCXbi+dxaTMzN/O2cGg/9btm27rvvtt16veerv5b6iGI1Gy+VSlrtLVVUdx5lOp5qm9TClr7IsK4rC87z7/V5VlSRJ4/F4s9ns9/vT6dTDpL5CDLRpmkB1XW+aBj716/Xa7Xbn81kgO4fhcAiBDJfLBeG2bRVFwedwOHAJOc9zjnC6uLPZjAbSNN1ut8/nE1Bd12iHYcglbczn884B09VqBZpe0cBKNIDk8XikXRZuSJDz8Xio8MhQliU4HizLQgJ5avphRwhPQgL7jYQvizOzgskzuYUKfJ5ut5uI9HFYLBZ4gcM9jmPkURUcwzB83ycMkfi+KIo+U3q/3wiAIwOfzXCRp9EgCCaTyfV6Zaa8MmW+6OPA7IRdkiQg4EMAQcHOrwEVaAH74/0HzZfYngCRRAMAAAAASUVORK5CYII=";
    const response = await fetch(settings.endpoint.trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey.trim()}` },
      body: JSON.stringify({
        model: settings.modelId.trim(),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "只输出 JSON。" },
          { role: "user", content: [{ type: "text", text: "返回 {\\\"vision\\\": true}" }, { type: "image_url", image_url: { url: testImage } }] },
        ],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeError(error?.message || "API Key 测试失败") };
  }
}

function normalizeError(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed?.error?.message || parsed?.message || value;
  } catch {
    return value;
  }
}

async function cropScreenshot(dataUrl, selection) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const { sx, sy, sw, sh } = resolveCropRect(bitmap.width, bitmap.height, selection);
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close?.();
  const output = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(output);
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function formatTime(iso) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
