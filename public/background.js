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

const MESSAGE = {
  TOGGLE_TOOLBAR: "prompt-capture/toggle-toolbar-v7",
  SHOW_TOOLBAR: "prompt-capture/show-toolbar-v7",
  START_SHORTCUT: "prompt-capture/start-shortcut-v7",
  CAPTURE_SELECTION: "prompt-capture/capture-selection-v7",
  CAPTURE_AND_GENERATE: "prompt-capture/capture-and-generate-v7",
  GENERATE_FROM_CAPTURE: "prompt-capture/generate-from-capture-v7",
  TEST_MODEL: "prompt-capture/test-model",
  COPY_TEXT: "prompt-capture/copy-text",
  OFFSCREEN_COPY_TEXT: "prompt-capture/offscreen-copy-text",
  COPY_TEXT_ON_PAGE: "prompt-capture/copy-text-on-page",
};

const STORAGE = {
  history: "promptCaptureHistory",
  settings: "promptCaptureSettings",
};

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  toggleToolbar(tab).catch(() => {});
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "start-selection") return;
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.id) startShortcut(tab).catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return false;

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

async function toggleToolbar(tab) {
  if (!canRunOnTab(tab)) return { ok: false, error: "当前页面暂不支持采集" };
  return sendToContent(tab.id, { type: MESSAGE.TOGGLE_TOOLBAR });
}

async function startShortcut(tab) {
  if (!canRunOnTab(tab)) return { ok: false, error: "当前页面暂不支持采集" };
  return sendToContent(tab.id, { type: MESSAGE.START_SHORTCUT });
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

function canRunOnTab(tab) {
  return Boolean(tab?.url && /^(https?|file):\/\//.test(tab.url));
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
    return { ok: false, error: normalizeError(error?.message || "Prompt 生成失败"), screenshotDataUrl };
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
    return { ok: false, error: normalizeError(error?.message || "Prompt 生成失败"), screenshotDataUrl };
  }
}

async function generateAndStore({ settings, screenshotDataUrl, selection, tab }) {
  const { prompts, promptMeta } = await requestVisionModel({ settings, imageDataUrl: screenshotDataUrl });
  const createdAt = new Date().toISOString();
  const record = {
    id: `capture-${Date.now()}`,
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
  const historyPayload = await chrome.storage.local.get(STORAGE.history);
  const history = Array.isArray(historyPayload[STORAGE.history]) ? historyPayload[STORAGE.history] : [];
  await chrome.storage.local.set({ [STORAGE.history]: [record, ...history.filter((item) => item.id !== record.id)] });
  return { ok: true, record };
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
