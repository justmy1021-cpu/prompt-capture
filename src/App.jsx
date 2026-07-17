import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import captureReference from "./assets/figma/capture-reference.jpeg";
import historyEmptyGif from "./assets/figma/history-empty.gif";
import promptCaptureTitle from "./assets/figma/title-prompt-capture.png";
import historyTitle from "./assets/figma/title-history.png";
import settingTitle from "./assets/figma/title-setting.png";
import historyIcon from "./assets/figma/icons/history.svg";
import settingsIcon from "./assets/figma/icons/settings.svg";
import closeIcon from "./assets/figma/icons/close.svg";
import copyIcon from "./assets/figma/icons/copy.svg";
import backIcon from "./assets/figma/icons/back.svg";
import imagePlusIcon from "./assets/figma/icons/image-plus.svg";
import cropIcon from "./assets/figma/icons/crop.svg";
import currentPageIcon from "./assets/figma/icons/current-page.svg";
import modelIcon from "./assets/figma/icons/model.svg";
import apiTestIcon from "./assets/figma/icons/api-test.svg";
import preferenceIcon from "./assets/figma/icons/preferences.svg";
import databaseIcon from "./assets/figma/icons/database.svg";
import checkboxCheckedIcon from "./assets/figma/icons/checkbox-checked.svg";
import searchIcon from "./assets/figma/icons/search.svg";
import selectChevronIcon from "./assets/figma/icons/select-chevron.svg";
import dividerIcon from "./assets/figma/icons/divider.svg";
import deleteIcon from "./assets/figma/icons/delete.svg";
import providerHelpIcon from "./assets/figma/icons/provider-help.svg";
import historyPlusIcon from "./assets/figma/history-plus.svg";
import historyMinusIcon from "./assets/figma/history-minus.svg";
import historyThumb01 from "./assets/figma/history-01.png";
import historyThumb02 from "./assets/figma/history-02.png";
import historyThumb03 from "./assets/figma/history-03.png";
import historyThumb04 from "./assets/figma/history-04.png";
import {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  MODEL_PROVIDERS,
  PROVIDER_IDS,
  createProviderProfile,
  getProvider,
  isModelSettingsReady,
  normalizeModelSettings,
  validateModelSettings,
} from "./model-providers.js";

const STORAGE = {
  history: "promptCaptureHistory",
  settings: "promptCaptureSettings",
};

const NAVIGATION_EXIT_MS = 160;
const NAVIGATION_ENTER_MS = 180;
const defaultSettings = {
  provider: DEFAULT_PROVIDER,
  modelId: DEFAULT_MODEL,
  apiKey: "",
  endpoint: DEFAULT_ENDPOINT,
  language: "zh",
  apiTestStatus: "idle",
};

const DEMO_PROMPTS = {
  image:
    "宽屏桌面端游戏产品公司官网首页，以纯黑背景呈现复古平台跳跃游戏场景。首屏左侧使用超大无衬线粗体标题“Passionate Gaming Product company”、短段说明文字和亮橙色“See vacancies”按钮；右侧放置黑白 8 位像素城堡、阶梯方块、旗杆与云朵。顶部为简洁横向导航，首屏下方排列四项业务数据，再衔接“What are we doing?”内容区。整体采用黑白高对比和单一亮橙强调色，结合等宽开发者注释、锐利线条与平面像素质感。生成 16:9 网页设计展示图，保持清晰文字层级和充足留白，避免渐变、玻璃拟态、柔和阴影及装饰性卡片堆叠。",
  style:
    "极简暗黑与数字粗野主义结合的视觉语言：纯黑底色、白色高反差文字、低饱和灰阶辅助信息，以亮橙作为唯一强调色。标题使用宽厚紧凑的无衬线粗体，辅助信息采用小号等宽字；图形保持 8 位像素颗粒、硬边线条和复古游戏机质感。整体克制、直接、技术感强，避免玻璃拟态、柔和渐变、圆润糖果色和装饰性阴影。",
  layout:
    "采用 16:9 宽屏桌面画布和清晰的纵向分区。顶部是单行导航；首屏主体使用左右不对称双栏，左栏依次放置主标题、说明文字和主要操作，右栏以大幅插画形成视觉重心。首屏底部设置四列等宽数据统计，保持统一基线与间距；第二内容区以大号分段标题承接后续介绍。各区沿同一左右页边距对齐，通过字号、占位面积和留白建立层级，不使用独立卡片包裹。单张截图未展示移动端与其他交互状态，不额外推断。",
};

const DEMO_PROMPT_META = {
  schemaVersion: "2.0",
  sourceType: "ui_page",
  sourceSummary: "黑橙高对比、像素游戏视觉的桌面端公司官网首页。",
};

const previewStateMap = {
  default: "idle",
  generating: "generating",
  result: "result",
  history: "history",
  empty: "history",
  settings: "settings",
  required: "required",
};

function getPreviewState() {
  const query = new URLSearchParams(window.location.search);
  return query.get("state") || "";
}

function getExtensionRuntime() {
  return globalThis.chrome?.runtime?.id ? globalThis.chrome : null;
}

function copyTextWithSelection(value) {
  const target = document.createElement("textarea");
  target.value = value;
  target.setAttribute("aria-hidden", "true");
  target.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;margin:0;padding:0;border:0;opacity:.01;pointer-events:none";
  document.body.appendChild(target);
  target.focus({ preventScroll: true });
  target.select();
  target.setSelectionRange(0, target.value.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    target.remove();
  }
  return copied;
}

function formatTime(iso) {
  if (!iso) return "2025-09-09 12:09";
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function createDemoRecord(id = "demo-record", thumbnailDataUrl = captureReference) {
  return {
    id,
    screenshotDataUrl: thumbnailDataUrl,
    thumbnailDataUrl,
    source: { title: "来源网页标题", url: "https://example.com" },
    createdAt: "2025-09-09T12:09:00.000Z",
    time: "2025-09-09 12:09",
    selectionType: "region",
    language: "zh",
    provider: DEFAULT_PROVIDER,
    modelId: DEFAULT_MODEL,
    prompts: DEMO_PROMPTS,
    promptMeta: DEMO_PROMPT_META,
  };
}

function cx(...items) {
  return items.filter(Boolean).join(" ");
}

async function readStoredData() {
  const extension = getExtensionRuntime();
  if (!extension?.storage?.local) {
    return { [STORAGE.history]: [], [STORAGE.settings]: defaultSettings };
  }
  return extension.storage.local.get([STORAGE.history, STORAGE.settings]);
}

async function saveSettings(settings) {
  const extension = getExtensionRuntime();
  if (extension?.storage?.local) {
    await extension.storage.local.set({ [STORAGE.settings]: settings });
  }
}

async function saveHistory(history) {
  const extension = getExtensionRuntime();
  if (extension?.storage?.local) {
    await extension.storage.local.set({ [STORAGE.history]: history });
  }
}

function toolbarHeight(screen, generationImageHeight = 224) {
  if (screen === "generating") return Math.min(472, Math.max(73, Math.round(generationImageHeight) + 72));
  if (screen === "error") return 296;
  if (screen === "result" || screen === "history" || screen === "settings") return 768;
  return 100;
}

function isSettingsComplete(settings) {
  return isModelSettingsReady(settings);
}

function normalizeSettings(raw = {}) {
  return {
    ...defaultSettings,
    ...normalizeModelSettings(raw),
  };
}

function AppIcon({ src, alt = "", className }) {
  return <img className={cx("pixel-icon", className)} src={src} alt={alt} />;
}

export function App() {
  const previewState = getPreviewState();
  const isEmbedded = window.parent !== window;
  const isPreview = Boolean(previewState) || !getExtensionRuntime();
  const previewUsesDemoConfig = isPreview && !["settings", "required"].includes(previewState);
  const initialRecord = useMemo(() => createDemoRecord(), []);
  const initialHistory = useMemo(() => [
    createDemoRecord("demo-record-1", historyThumb01),
    createDemoRecord("demo-record-2", historyThumb02),
    createDemoRecord("demo-record-3", historyThumb03),
    createDemoRecord("demo-record-4", historyThumb04),
  ], []);
  const [screen, setScreen] = useState(() => previewStateMap[previewState] || "idle");
  const [settings, setSettings] = useState(() => ({
    ...defaultSettings,
    ...(previewUsesDemoConfig ? { provider: DEFAULT_PROVIDER, modelId: DEFAULT_MODEL, apiKey: "demo-key", endpoint: DEFAULT_ENDPOINT, apiTestStatus: "success" } : {}),
  }));
  const [history, setHistory] = useState(() => (previewState === "empty" ? [] : isPreview ? initialHistory : []));
  const [capture, setCapture] = useState(() => (isPreview && ["generating", "result"].includes(previewStateMap[previewState]) ? initialRecord : null));
  const [candidate, setCandidate] = useState(null);
  const [selectionMode, setSelectionMode] = useState("");
  const [previousScreen, setPreviousScreen] = useState("idle");
  const [activePrompt, setActivePrompt] = useState("image");
  const [expandedHistoryId, setExpandedHistoryId] = useState(previewState === "history" ? "demo-record-3" : "");
  const [historyEditing, setHistoryEditing] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState([]);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [notice, setNotice] = useState("");
  const [navigationMotion, setNavigationMotion] = useState({ phase: "idle", direction: "forward" });
  const [errorMessage, setErrorMessage] = useState("");
  const [retryCapture, setRetryCapture] = useState(null);
  const [selectionHint, setSelectionHint] = useState("");
  const [generationImageHeight, setGenerationImageHeight] = useState(224);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const returnScreenRef = useRef("idle");
  const clearHistoryTriggerRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const navigationTimersRef = useRef([]);
  const currentScreenRef = useRef(screen);

  const configured = isSettingsComplete(settings);
  const visibleHistory = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return history;
    return history.filter((record) =>
      [record.source?.title, record.source?.url, record.prompts?.image, record.prompts?.style, record.prompts?.layout]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [history, query]);

  const postToHost = (type, payload = {}) => {
    if (!isEmbedded) return;
    window.parent.postMessage({ channel: "prompt-capture", type, payload }, "*");
  };

  const clearNotice = () => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = null;
    setNotice("");
  };

  const showNotice = (message, duration = 2400) => {
    if (currentScreenRef.current !== "settings") return;
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = null;
    setNotice(message);
    if (message && duration > 0) {
      noticeTimerRef.current = window.setTimeout(() => {
        setNotice("");
        noticeTimerRef.current = null;
      }, duration);
    }
  };

  const clearNavigationTimers = () => {
    navigationTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    navigationTimersRef.current = [];
  };

  const transitionToScreen = (next, direction) => {
    if (next === screen) return;
    clearNotice();
    clearNavigationTimers();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setScreen(next);
      setNavigationMotion({ phase: "idle", direction });
      return;
    }
    setNavigationMotion({ phase: "exit", direction });
    const swapTimer = window.setTimeout(() => {
      setScreen(next);
      setNavigationMotion({ phase: "enter", direction });
      const settleTimer = window.setTimeout(() => {
        setNavigationMotion({ phase: "idle", direction });
        navigationTimersRef.current = [];
      }, NAVIGATION_ENTER_MS);
      navigationTimersRef.current.push(settleTimer);
    }, NAVIGATION_EXIT_MS);
    navigationTimersRef.current.push(swapTimer);
  };

  const cancelPendingSelection = () => {
    setCandidate(null);
    setSelectionMode("");
    setRetryCapture(null);
    setErrorMessage("");
    setSelectionHint("");
    postToHost("PC_CANCEL_SELECTION");
  };

  const openScreen = (next) => {
    if (next === screen) return;
    cancelPendingSelection();
    setPreviousScreen(screen);
    transitionToScreen(next, "forward");
  };

  const returnFromSubpage = () => {
    if (screen === "history") {
      setHistoryEditing(false);
      setSelectedHistoryIds([]);
    }
    const next = previousScreen === "settings" || previousScreen === "history" ? "idle" : previousScreen;
    transitionToScreen(next, "back");
  };

  const updateSettings = async (patch) => {
    const updated = { ...settings, ...patch };
    const next = {
      ...updated,
      providerProfiles: {
        ...(updated.providerProfiles || {}),
        [updated.provider]: createProviderProfile(updated),
      },
    };
    setSettings(next);
    await saveSettings(next);
  };

  const startCapture = (mode) => {
    if (!configured) {
      setPreviousScreen(screen);
      setScreen("required");
      return;
    }
    returnScreenRef.current = screen;
    setSelectionMode(mode);
    setSelectionHint(
      mode === "page"
        ? "正在截取当前页面。"
        : mode === "image"
          ? "图片选择模式已开启。使用方向键切换候选图片，按 Enter 选择，按 Escape 取消。"
          : "框选截图模式已开启。拖动鼠标绘制区域，按 Escape 取消。",
    );
    setScreen("idle");
    if (isEmbedded) {
      postToHost("PC_START_SELECTION", { mode });
      return;
    }
    setCandidate({ type: mode, screenshotDataUrl: capture?.screenshotDataUrl || captureReference });
  };

  const reselect = () => {
    setCandidate(null);
    setSelectionMode("");
    setRetryCapture(null);
    setErrorMessage("");
    setSelectionHint("");
    postToHost("PC_RESELECT");
    setScreen("idle");
  };

  const confirmCandidate = () => {
    if (!candidate) return;
    setErrorMessage("");
    setGenerationImageHeight(224);
    if (isEmbedded) {
      setScreen("generating");
      postToHost("PC_CONFIRM_SELECTION");
      return;
    }
    setScreen("generating");
    window.setTimeout(() => {
      const record = {
        ...createDemoRecord(`demo-${Date.now()}`),
        screenshotDataUrl: candidate.screenshotDataUrl || captureReference,
        createdAt: new Date().toISOString(),
      };
      setCapture(record);
      setHistory((items) => [record, ...items]);
      setCandidate(null);
      setSelectionMode("");
      setSelectionHint("");
      setScreen("result");
    }, 1200);
  };

  const retryGeneration = () => {
    if (!retryCapture?.screenshotDataUrl) {
      setErrorMessage("原截图不可用，请重新选择后生成。");
      return;
    }
    setErrorMessage("");
    setGenerationImageHeight(224);
    setScreen("generating");
    if (isEmbedded) {
      postToHost("PC_RETRY_GENERATION", { capture: retryCapture });
      return;
    }
    window.setTimeout(() => {
      const record = {
        ...createDemoRecord(`retry-${Date.now()}`),
        screenshotDataUrl: retryCapture.screenshotDataUrl,
        thumbnailDataUrl: retryCapture.screenshotDataUrl,
        source: retryCapture.source || { title: "来源网页标题", url: "" },
      };
      setCapture(record);
      setHistory((items) => [record, ...items]);
      setRetryCapture(null);
      setScreen("result");
    }, 800);
  };

  const copyCurrentPrompt = async (promptValue) => {
    const value = promptValue || (capture || history[0])?.prompts?.[activePrompt] || "";
    try {
      if (!value) throw new Error("没有可复制的提示词");
      let clipboardWrite = null;
      if (navigator.clipboard?.writeText) {
        try {
          clipboardWrite = navigator.clipboard.writeText(value);
        } catch {
          clipboardWrite = null;
        }
      }

      let copiedDirectly = false;
      try {
        copiedDirectly = copyTextWithSelection(value);
      } catch {
        copiedDirectly = false;
      }

      if (copiedDirectly) {
        clipboardWrite?.catch?.(() => undefined);
      } else if (clipboardWrite) {
        try {
          await clipboardWrite;
          copiedDirectly = true;
        } catch {
          copiedDirectly = false;
        }
      }

      if (!copiedDirectly) {
        const extension = getExtensionRuntime();
        if (extension?.runtime?.sendMessage) {
          const response = await extension.runtime.sendMessage({ type: "prompt-capture/copy-text", text: value });
          if (!response?.ok) throw new Error(response?.error || "复制失败");
        } else if (isEmbedded) {
          await new Promise((resolve, reject) => {
            const requestId = `copy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const timer = window.setTimeout(() => {
              window.removeEventListener("message", onResult);
              reject(new Error("复制超时"));
            }, 2000);
            function onResult(event) {
              const message = event.data;
              if (message?.channel !== "prompt-capture" || message.type !== "PC_COPY_RESULT" || message.payload?.requestId !== requestId) return;
              window.clearTimeout(timer);
              window.removeEventListener("message", onResult);
              if (message.payload?.ok) resolve();
              else reject(new Error(message.payload?.error || "复制失败"));
            }
            window.addEventListener("message", onResult);
            postToHost("PC_COPY_TEXT", { requestId, text: value });
          });
        } else {
          throw new Error("当前环境不支持复制");
        }
      }
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 1300);
    } catch {
      setCopyError(true);
      window.setTimeout(() => setCopyError(false), 2200);
    }
  };

  const testApi = async () => {
    const validationError = validateModelSettings(settings);
    if (validationError) {
      showNotice(validationError);
      return;
    }
    showNotice("正在测试 API Key…", 0);
    if (isPreview) {
      window.setTimeout(() => {
        void updateSettings({ apiTestStatus: "success" });
        showNotice("连接成功");
      }, 600);
      return;
    }
    try {
      const response = await getExtensionRuntime().runtime.sendMessage({ type: "prompt-capture/test-model", settings });
      if (!response?.ok) throw new Error(response?.error || "连接失败");
      await updateSettings({ apiTestStatus: "success" });
      showNotice("连接成功");
    } catch (error) {
      await updateSettings({ apiTestStatus: "failed" });
      showNotice(error?.message || "连接失败");
    }
  };

  const clearHistory = async () => {
    setHistory([]);
    setHistoryEditing(false);
    setSelectedHistoryIds([]);
    setExpandedHistoryId("");
    await saveHistory([]);
    setShowClearDialog(false);
    showNotice("历史记录已清理");
    window.requestAnimationFrame(() => clearHistoryTriggerRef.current?.focus());
  };

  const requestClearHistory = (event) => {
    clearHistoryTriggerRef.current = event.currentTarget;
    setShowClearDialog(true);
  };

  const cancelClearHistory = () => {
    setShowClearDialog(false);
    window.requestAnimationFrame(() => clearHistoryTriggerRef.current?.focus());
  };

  const startHistoryEdit = () => {
    if (!history.length) return;
    setHistoryEditing(true);
    setSelectedHistoryIds([]);
  };

  const finishHistoryEdit = () => {
    setHistoryEditing(false);
    setSelectedHistoryIds([]);
  };

  const toggleHistorySelection = (recordId) => {
    setSelectedHistoryIds((items) => items.includes(recordId) ? items.filter((id) => id !== recordId) : [...items, recordId]);
  };

  const deleteSelectedHistory = async () => {
    if (!selectedHistoryIds.length) return;
    const selected = new Set(selectedHistoryIds);
    const next = history.filter((record) => !selected.has(record.id));
    setHistory(next);
    setSelectedHistoryIds([]);
    if (selected.has(expandedHistoryId)) setExpandedHistoryId("");
    if (!next.length) setHistoryEditing(false);
    await saveHistory(next);
  };

  useEffect(() => () => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    navigationTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    currentScreenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    const availableIds = new Set(history.map((record) => record.id));
    setSelectedHistoryIds((items) => items.filter((id) => availableIds.has(id)));
    if (!history.length) setHistoryEditing(false);
  }, [history]);

  useEffect(() => {
    if (screen === "settings") return;
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = null;
    setNotice("");
  }, [screen]);

  useEffect(() => {
    if (isPreview) return undefined;
    let live = true;
    readStoredData().then((data) => {
      if (!live) return;
      const storedSettings = normalizeSettings(data[STORAGE.settings]);
      setSettings(storedSettings);
      if (getExtensionRuntime()?.storage?.local && JSON.stringify(data[STORAGE.settings] || {}) !== JSON.stringify(storedSettings)) {
        void saveSettings(storedSettings);
      }
      setHistory(Array.isArray(data[STORAGE.history]) ? data[STORAGE.history] : []);
      if (!isSettingsComplete(storedSettings)) setScreen("required");
    });
    const onStorageChanged = (changes, area) => {
      if (area !== "local") return;
      if (changes[STORAGE.settings]?.newValue) setSettings(normalizeSettings(changes[STORAGE.settings].newValue));
      if (changes[STORAGE.history]?.newValue) setHistory(changes[STORAGE.history].newValue || []);
    };
    globalThis.chrome?.storage?.onChanged?.addListener(onStorageChanged);
    return () => {
      live = false;
      globalThis.chrome?.storage?.onChanged?.removeListener(onStorageChanged);
    };
  }, [isPreview]);

  useEffect(() => {
    if (!isEmbedded) return undefined;
    const onMessage = (event) => {
      const message = event.data;
      if (!message || message.channel !== "prompt-capture") return;
      if (message.type === "PC_SELECTION_CANDIDATE") {
        setCandidate(message.payload);
        setSelectionMode(message.payload?.type || "");
        setScreen("idle");
      }
      if (message.type === "PC_CAPTURE_READY") {
        const readyCapture = message.payload?.capture;
        if (readyCapture?.screenshotDataUrl) {
          setCapture((current) => ({ ...(current || {}), ...readyCapture, thumbnailDataUrl: readyCapture.screenshotDataUrl }));
        }
        setGenerationImageHeight(224);
        setScreen("generating");
      }
      if (message.type === "PC_SELECTION_CANCELLED") {
        setCandidate(null);
        setSelectionMode("");
        setScreen(returnScreenRef.current === "result" ? "result" : "idle");
      }
      if (message.type === "PC_GENERATION_SUCCESS") {
        const record = message.payload?.record;
        if (record) {
          setCapture(record);
          setHistory((items) => [record, ...items.filter((item) => item.id !== record.id)]);
        }
        setCandidate(null);
        setSelectionMode("");
        setRetryCapture(null);
        setErrorMessage("");
        setSelectionHint("");
        setScreen("result");
      }
      if (message.type === "PC_GENERATION_ERROR") {
        const failedCapture = {
          screenshotDataUrl: message.payload?.screenshotDataUrl || "",
          selectionType: message.payload?.selection?.type || "region",
          source: {
            title: message.payload?.selection?.title || "来源网页标题",
            url: message.payload?.selection?.url || "",
          },
        };
        setRetryCapture(failedCapture);
        if (failedCapture.screenshotDataUrl) setCapture((current) => ({ ...(current || createDemoRecord("failed-capture")), ...failedCapture, thumbnailDataUrl: failedCapture.screenshotDataUrl }));
        setCandidate(null);
        setSelectionMode("");
        setErrorMessage(message.payload?.error || "生成失败，请重试");
        setSelectionHint("");
        setScreen("error");
      }
      if (message.type === "PC_SELECTION_HINT") setSelectionHint(message.payload?.text || "");
      if (message.type === "PC_START_SHORTCUT") startCapture("region");
      if (message.type === "PC_SHOW_TOOLBAR") {
        if (!configured) setScreen("required");
      }
      if (message.type === "PC_FORCE_REQUIRED") setScreen("required");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [configured, isEmbedded]);

  useEffect(() => {
    postToHost("PC_RESIZE", { height: toolbarHeight(screen, generationImageHeight) });
  }, [screen, generationImageHeight]);

  useEffect(() => {
    postToHost("PC_NAVIGATION_MOTION", { active: navigationMotion.phase !== "idle" });
  }, [navigationMotion.phase]);

  const activeRecord = capture || history[0] || initialRecord;
  const displayScreen = screen === "required" && configured ? "idle" : screen;
  const currentToolbarHeight = toolbarHeight(displayScreen, generationImageHeight);

  return (
    <main className={cx("preview-stage", isEmbedded && "embedded-stage")} data-embed={isEmbedded ? "true" : "false"}>
      <section
        className={cx(
          "toolbar",
          `toolbar--${currentToolbarHeight}`,
          navigationMotion.phase !== "idle" && `toolbar--motion-${navigationMotion.phase}-${navigationMotion.direction}`
        )}
        style={{ "--toolbar-height": `${currentToolbarHeight}px` }}
        aria-label="Prompt Capture"
        inert={showClearDialog ? true : undefined}
      >
        <div className="toolbar-surface">
          <ToolbarHeader
            screen={displayScreen}
            onHistory={() => openScreen("history")}
            onSettings={() => openScreen("settings")}
            onBack={returnFromSubpage}
            onClose={() => {
              clearNotice();
              setCandidate(null);
              setSelectionMode("");
              setRetryCapture(null);
              setSelectionHint("");
              postToHost("PC_HIDE_TOOLBAR");
            }}
            onDragStart={(event) => {
              postToHost("PC_DRAG_START", event);
            }}
            onDragMove={(event) => {
              postToHost("PC_DRAG_MOVE", event);
            }}
            onDragEnd={(event) => {
              postToHost("PC_DRAG_END", event);
            }}
          />

          {displayScreen === "required" && <RequiredState onSettings={() => openScreen("settings")} />}

          {displayScreen === "idle" && (
            <ActionBar
              candidate={candidate}
              selectionMode={selectionMode}
              onCurrentPage={() => startCapture("page")}
              onChooseImage={() => startCapture("image")}
              onRegion={() => startCapture("region")}
              onReselect={reselect}
              onConfirm={confirmCandidate}
              onImageKey={(key) => postToHost("PC_IMAGE_KEY", { key })}
            />
          )}

          {displayScreen === "generating" && (
            <GeneratingState
              capture={activeRecord}
              onImageLoad={(event) => {
                const image = event.currentTarget;
                const availableWidth = image.parentElement?.clientWidth || 336;
                const ratio = image.naturalWidth > 0 ? image.naturalHeight / image.naturalWidth : 2 / 3;
                setGenerationImageHeight(Math.min(400, Math.max(1, Math.round(availableWidth * ratio))));
              }}
            />
          )}

          {displayScreen === "error" && (
            <ErrorState
              capture={activeRecord}
              message={errorMessage}
              onRetry={retryGeneration}
              onReselect={reselect}
              onSettings={() => openScreen("settings")}
            />
          )}

          {displayScreen === "result" && (
            <ResultState
              record={activeRecord}
              activePrompt={activePrompt}
              setActivePrompt={setActivePrompt}
              copied={copied}
              copyError={copyError}
              onCopy={copyCurrentPrompt}
              onCurrentPage={() => startCapture("page")}
              onChooseImage={() => startCapture("image")}
              onRegion={() => startCapture("region")}
              onImageKey={(key) => postToHost("PC_IMAGE_KEY", { key })}
            />
          )}

          {displayScreen === "history" && (
            <HistoryState
              query={query}
              setQuery={setQuery}
              history={visibleHistory}
              historyCount={history.length}
              editing={historyEditing}
              selectedIds={selectedHistoryIds}
              expandedId={expandedHistoryId}
              setExpandedId={setExpandedHistoryId}
              activePrompt={activePrompt}
              setActivePrompt={setActivePrompt}
              copied={copied}
              copyError={copyError}
              onCopy={copyCurrentPrompt}
              onStartEdit={startHistoryEdit}
              onFinishEdit={finishHistoryEdit}
              onToggleSelection={toggleHistorySelection}
              onDeleteSelected={deleteSelectedHistory}
              onClear={requestClearHistory}
            />
          )}

          {displayScreen === "settings" && (
            <SettingsState
              settings={settings}
              notice={notice}
              onUpdate={updateSettings}
              onTest={testApi}
              onClear={requestClearHistory}
            />
          )}
        </div>
      </section>

      <span className="sr-only" aria-live="polite">{selectionHint}</span>
      {showClearDialog && <ClearHistoryDialog onCancel={cancelClearHistory} onConfirm={clearHistory} />}
    </main>
  );
}

function ToolbarHeader({ screen, onHistory, onSettings, onBack, onClose, onDragStart, onDragMove, onDragEnd }) {
  const subpage = screen === "history" || screen === "settings";
  const title = screen === "history" ? "HISTORY" : screen === "settings" ? "SETTING" : "PROMPT CAPTURE";
  const titleImage = screen === "history" ? historyTitle : screen === "settings" ? settingTitle : promptCaptureTitle;
  const dragPointRef = useRef(null);

  const finishDrag = (event) => {
    const active = dragPointRef.current;
    if (!active || (event?.pointerId != null && event.pointerId !== active.pointerId)) return;
    dragPointRef.current = null;
    if (event?.currentTarget?.hasPointerCapture?.(active.pointerId)) {
      event.currentTarget.releasePointerCapture(active.pointerId);
    }
    onDragEnd({ pointerId: active.pointerId });
  };

  return (
    <header
      className="toolbar-header"
      onPointerDown={(event) => {
        if (event.button !== 0 || event.target.closest?.("button")) return;
        event.preventDefault();
        dragPointRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onDragStart({
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
        });
      }}
      onPointerMove={(event) => {
        const previous = dragPointRef.current;
        if (!previous || event.pointerId !== previous.pointerId) return;
        event.preventDefault();

        const nativeEvent = event.nativeEvent || event;
        const screenDeltaX = Number(event.screenX) - Number(previous.screenX);
        const screenDeltaY = Number(event.screenY) - Number(previous.screenY);
        const movementX = Number(nativeEvent.movementX);
        const movementY = Number(nativeEvent.movementY);
        const clientDeltaX = Number(event.clientX) - Number(previous.clientX);
        const clientDeltaY = Number(event.clientY) - Number(previous.clientY);

        let deltaX = screenDeltaX;
        let deltaY = screenDeltaY;
        if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (deltaX === 0 && deltaY === 0)) {
          deltaX = movementX;
          deltaY = movementY;
        }
        if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (deltaX === 0 && deltaY === 0)) {
          deltaX = clientDeltaX;
          deltaY = clientDeltaY;
        }

        dragPointRef.current = {
          pointerId: previous.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
        };
        if (Number.isFinite(deltaX) && Number.isFinite(deltaY) && (deltaX !== 0 || deltaY !== 0)) {
          onDragMove({ pointerId: event.pointerId, movementX: deltaX, movementY: deltaY });
        }
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
    >
      <div className="toolbar-drag-zone">
        {subpage && (
          <button className="header-icon header-back" type="button" aria-label="返回" onClick={onBack}>
            <AppIcon src={backIcon} />
          </button>
        )}
        <h1 aria-label={title}>
          <img className="toolbar-title-image" src={titleImage} alt="" />
        </h1>
      </div>
      <div className="header-actions">
        {!subpage && (
          <>
            <button className="header-icon" type="button" aria-label="历史记录" onClick={onHistory}>
              <AppIcon src={historyIcon} />
            </button>
            <button className="header-icon" type="button" aria-label="设置" onClick={onSettings}>
              <AppIcon src={settingsIcon} />
            </button>
          </>
        )}
        <button className="header-icon" type="button" aria-label="关闭" onClick={onClose}>
          <AppIcon src={closeIcon} />
        </button>
      </div>
    </header>
  );
}

function ActionBar({ candidate, selectionMode, onCurrentPage, onChooseImage, onRegion, onReselect, onConfirm, onImageKey }) {
  if (candidate) {
    return (
      <div className="action-bar">
        <button className="capture-action capture-action--secondary" type="button" onClick={onReselect}>
          <AppIcon src={imagePlusIcon} />
          重选
        </button>
        <button className="capture-action capture-action--primary" type="button" onClick={onConfirm}>
          <AppIcon src={cropIcon} />
          确认
        </button>
      </div>
    );
  }
  return (
    <div className="action-bar action-bar--default" onKeyDown={(event) => {
      if (selectionMode !== "image" || !["ArrowLeft", "ArrowRight", "Enter", "Escape"].includes(event.key)) return;
      event.preventDefault();
      onImageKey?.(event.key);
    }}>
      <button className={cx("capture-action", "capture-action--secondary", selectionMode === "page" && "is-active")} type="button" onClick={onCurrentPage}>
        <AppIcon src={currentPageIcon} />
        当前页面
      </button>
      <button className={cx("capture-action", "capture-action--secondary", selectionMode === "image" && "is-active")} type="button" onClick={onChooseImage}>
        <AppIcon src={imagePlusIcon} />
        选择图片
      </button>
      <button className={cx("capture-action", "capture-action--primary", selectionMode === "region" && "is-active")} type="button" onClick={onRegion}>
        <AppIcon src={cropIcon} />
        框选截图
      </button>
    </div>
  );
}

function RequiredState({ onSettings }) {
  return (
    <div className="required-state">
      <span>请完成模型设置并通过连接测试</span>
      <button className="capture-action capture-action--primary" type="button" onClick={onSettings}>前往设置</button>
    </div>
  );
}

function GeneratingState({ capture, onImageLoad }) {
  return (
    <div className="generation-state">
      <div className="capture-image scan-image">
        <img src={capture?.screenshotDataUrl || captureReference} alt="正在分析的截图" onLoad={onImageLoad} />
        <span className="scan-band" aria-hidden="true" />
        <span className="generation-label" role="status">正在分析截图…</span>
      </div>
    </div>
  );
}

function ErrorState({ capture, message, onRetry, onReselect, onSettings }) {
  const needsSettings = /模型设置|API Key|模型 ID/.test(message || "");
  return (
    <div className="error-state">
      <div className="capture-image error-image"><img src={capture?.screenshotDataUrl || captureReference} alt="生成失败的截图" /></div>
      <p>{message || "生成失败，请检查模型设置后重试"}</p>
      <div className="error-actions">
        <button type="button" onClick={onReselect}>重新选择</button>
        {needsSettings ? <button type="button" onClick={onSettings}>前往设置</button> : <button type="button" onClick={onRetry}>重新生成</button>}
      </div>
    </div>
  );
}

function PromptTabs({ activePrompt, setActivePrompt, panelId }) {
  const tabs = [
    ["image", "图片"],
    ["style", "风格"],
    ["layout", "布局"],
  ];
  const moveTab = (event) => {
    const currentIndex = tabs.findIndex(([id]) => id === activePrompt);
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (currentIndex + delta + tabs.length) % tabs.length;
    const next = tabs[nextIndex][0];
    setActivePrompt(next);
    event.currentTarget.parentElement?.querySelector(`[data-prompt-tab="${next}"]`)?.focus();
  };
  return (
    <div className="prompt-tabs" role="tablist" aria-label="提示词类型">
      {tabs.map(([id, label], index) => (
        <Fragment key={id}>
          {index > 0 && <AppIcon src={dividerIcon} className="prompt-tab-divider" />}
          <button id={`${panelId}-tab-${id}`} data-prompt-tab={id} className={cx(activePrompt === id && "is-selected")} type="button" role="tab" tabIndex={activePrompt === id ? 0 : -1} aria-selected={activePrompt === id} aria-controls={panelId} onKeyDown={moveTab} onClick={() => setActivePrompt(id)}>{label}</button>
        </Fragment>
      ))}
    </div>
  );
}

function CopyControl({ copied, copyError, onCopy }) {
  return (
    <button className={cx("copy-control", copied && "is-copied", copyError && "is-error")} type="button" onClick={() => onCopy()} aria-live="polite">
      <AppIcon src={copyIcon} className="copy-glyph" />
      {copyError ? "复制失败" : copied ? "已复制" : "复制"}
    </button>
  );
}

function ResultState({ record, activePrompt, setActivePrompt, copied, copyError, onCopy, onCurrentPage, onChooseImage, onRegion, onImageKey }) {
  return (
    <div className="result-state">
      <div className="capture-image result-image"><img src={record?.screenshotDataUrl || captureReference} alt="已采集的网页截图" /></div>
      <section className="prompt-panel">
        <div className="prompt-panel-head">
          <PromptTabs activePrompt={activePrompt} setActivePrompt={setActivePrompt} panelId="result-prompt-panel" />
          <CopyControl copied={copied} copyError={copyError} onCopy={onCopy} />
        </div>
        <div id="result-prompt-panel" className="prompt-text" role="tabpanel" aria-labelledby={`result-prompt-panel-tab-${activePrompt}`} tabIndex="0">{record?.prompts?.[activePrompt] || DEMO_PROMPTS[activePrompt]}</div>
      </section>
      <ActionBar onCurrentPage={onCurrentPage} onChooseImage={onChooseImage} onRegion={onRegion} onImageKey={onImageKey} />
    </div>
  );
}

function HistoryState({
  query,
  setQuery,
  history,
  historyCount,
  editing,
  selectedIds,
  expandedId,
  setExpandedId,
  activePrompt,
  setActivePrompt,
  copied,
  copyError,
  onCopy,
  onStartEdit,
  onFinishEdit,
  onToggleSelection,
  onDeleteSelected,
  onClear,
}) {
  const editButton = (
    <button
      className={cx("history-edit-button", editing && "is-active")}
      type="button"
      disabled={!historyCount}
      onClick={editing ? onFinishEdit : onStartEdit}
    >
      {editing ? "完成" : "编辑"}
    </button>
  );
  const searchControl = (
    <div className="history-top-controls">
      <label className="history-search">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Prompt" aria-label="搜索 Prompt" />
        <AppIcon src={searchIcon} className="history-search-icon" />
      </label>
      {editButton}
    </div>
  );

  if (!history.length && !query) {
    return (
      <div className="history-state history-empty-state">
        {searchControl}
        <div className="history-empty-copy">
          <img src={historyEmptyGif} alt="像素蛇正在进食" />
          <p>正在等待第一颗数据果实</p>
        </div>
      </div>
    );
  }
  return (
    <div className={cx("history-state", editing && "is-editing")}>
      {searchControl}
      <div className="history-list">
        {!history.length ? (
          <p className="history-no-result">未找到匹配的 Prompt</p>
        ) : (
          history.map((record) => {
            const expanded = expandedId === record.id;
            const selected = selectedIds.includes(record.id);
            return (
              <article key={record.id} className={cx("history-record", expanded && "is-expanded", editing && "is-editing")}>
                {editing && (
                  <button
                    className={cx("history-checkbox", selected && "is-selected")}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={`${selected ? "取消选择" : "选择"}${record.source?.title || "来源网页标题"}`}
                    onClick={() => onToggleSelection(record.id)}
                  >
                    {selected ? <AppIcon src={checkboxCheckedIcon} /> : <span aria-hidden="true" />}
                  </button>
                )}
                <div className="history-record-card">
                  <button className="history-row" type="button" aria-expanded={expanded} aria-controls={`history-detail-${record.id}`} aria-label={`${expanded ? "收起" : "展开"}${record.source?.title || "来源网页标题"}，${record.time || formatTime(record.createdAt)}`} onClick={() => setExpandedId(expanded ? "" : record.id)}>
                    <img className="history-thumbnail" src={record.thumbnailDataUrl || record.screenshotDataUrl || captureReference} alt="" />
                    <span><strong>{record.source?.title || "来源网页标题"}</strong><small>{record.time || formatTime(record.createdAt)}</small></span>
                    <AppIcon src={expanded ? historyMinusIcon : historyPlusIcon} className="history-toggle-icon" />
                  </button>
                  {expanded && (
                    <div id={`history-detail-${record.id}`} className="history-detail">
                      <div className="prompt-panel-head">
                        <PromptTabs activePrompt={activePrompt} setActivePrompt={setActivePrompt} panelId={`history-prompt-${record.id}`} />
                        <CopyControl copied={copied} copyError={copyError} onCopy={() => onCopy(record.prompts?.[activePrompt] || DEMO_PROMPTS[activePrompt])} />
                      </div>
                      <div id={`history-prompt-${record.id}`} className="history-prompt-text" role="tabpanel" aria-labelledby={`history-prompt-${record.id}-tab-${activePrompt}`} tabIndex="0">{record.prompts?.[activePrompt] || DEMO_PROMPTS[activePrompt]}</div>
                    </div>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
      {editing && (
        <div className="history-batch-bar" aria-label="历史记录批量操作">
          <button type="button" onClick={onClear}>清空</button>
          <button type="button" disabled={!selectedIds.length} onClick={onDeleteSelected}>
            <span className="delete-icon-mask" style={{ "--delete-icon": `url(${deleteIcon})` }} aria-hidden="true" />
            删除
          </button>
        </div>
      )}
    </div>
  );
}

function SettingsState({ settings, notice, onUpdate, onTest, onClear }) {
  const provider = getProvider(settings.provider);
  const onProviderChange = (value) => {
    const nextProvider = getProvider(value);
    const providerProfiles = {
      ...(settings.providerProfiles || {}),
      [settings.provider]: createProviderProfile(settings),
    };
    const savedProfile = providerProfiles[nextProvider.id];
    onUpdate({
      provider: nextProvider.id,
      modelId: savedProfile?.modelId || nextProvider.defaultModelId,
      endpoint: savedProfile?.endpoint || nextProvider.endpoint,
      apiKey: savedProfile?.apiKey || "",
      apiTestStatus: savedProfile?.apiTestStatus || "idle",
      providerProfiles,
    });
  };

  return (
    <div className="settings-state">
      {notice && <p className="settings-notice" role="status">{notice}</p>}
      <section className="settings-group">
        <div className="settings-group-head">
          <h2><AppIcon src={modelIcon} />模型服务</h2>
          <button className="api-test-button" type="button" onClick={onTest}><AppIcon src={apiTestIcon} />API Key 测试</button>
        </div>
        <FieldLabel
          required
          label="服务商"
          hint={provider.id === PROVIDER_IDS.OPENAI_COMPATIBLE
            ? "适用于兼容 OpenAI Chat Completions 且支持图片输入的模型服务。填写模型 ID、API Key 和完整接口地址后，请完成连接测试。"
            : "选择服务商后，填写对应的模型 ID、API Key 和接口地址。完成配置后点击「API Key 测试」，测试通过后即可开始采集。"}
        >
          <DropdownSelect
            ariaLabel="服务商"
            value={settings.provider}
            options={Object.values(MODEL_PROVIDERS).map((item) => ({ value: item.id, label: item.label }))}
            onChange={onProviderChange}
          />
        </FieldLabel>
        <FieldLabel required label="模型 ID">
          <ModelCombobox
            key={provider.id}
            value={settings.modelId}
            options={provider.models}
            placeholder={provider.id === "volcengine" ? "请输入模型或推理接入点 ID" : "请输入或选择模型 ID"}
            onChange={(modelId) => onUpdate({ modelId, apiTestStatus: "idle" })}
          />
        </FieldLabel>
        <FieldLabel required label="API Key"><input type="password" value={settings.apiKey} placeholder="请输入" autoComplete="off" onChange={(event) => onUpdate({ apiKey: event.target.value, apiTestStatus: "idle" })} /></FieldLabel>
        <FieldLabel required label="接口地址"><input type="url" value={settings.endpoint} placeholder="请输入完整的 Chat Completions 地址" autoComplete="off" spellCheck="false" onChange={(event) => onUpdate({ endpoint: event.target.value, apiTestStatus: "idle" })} /></FieldLabel>
      </section>
      <section className="settings-group">
        <div className="settings-group-head"><h2><AppIcon src={preferenceIcon} />输出偏好</h2></div>
        <FieldLabel required label="默认语言">
          <DropdownSelect
            ariaLabel="默认语言"
            value={settings.language}
            options={[{ value: "zh", label: "中文" }, { value: "en", label: "English" }, { value: "bilingual", label: "中英双语" }]}
            onChange={(language) => onUpdate({ language })}
          />
        </FieldLabel>
      </section>
      <section className="settings-group settings-group--last">
        <div className="settings-group-head"><h2><AppIcon src={databaseIcon} />本地数据</h2></div>
        <div className="data-actions">
          <p className="storage-note">历史截图与 Prompt 仅保存在此浏览器的扩展本地存储中。</p>
          <button type="button" onClick={onClear}>清理历史</button>
        </div>
      </section>
      <p className="settings-version">v0.2.5</p>
    </div>
  );
}

function DropdownSelect({ ariaLabel, value, options, onChange }) {
  const rootRef = useRef(null);
  const listboxId = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const selectOption = (index) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (!["ArrowDown", "ArrowUp", "Enter", " ", "Escape"].includes(event.key)) return;
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    event.preventDefault();
    if (!open) {
      setActiveIndex(selectedIndex);
      setOpen(true);
      return;
    }
    if (event.key === "ArrowDown") setActiveIndex((index) => (index + 1) % options.length);
    if (event.key === "ArrowUp") setActiveIndex((index) => (index - 1 + options.length) % options.length);
    if (event.key === "Enter" || event.key === " ") selectOption(activeIndex);
  };

  return (
    <div ref={rootRef} className={cx("custom-select", open && "is-open")}>
      <button
        className="dropdown-control"
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          setActiveIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.label || "请选择"}</span>
        <AppIcon src={selectChevronIcon} />
      </button>
      {open && (
        <div id={listboxId} className="dropdown-menu" role="listbox" aria-label={`${ariaLabel}选项`}>
          {options.map((option, index) => (
            <button
              className={cx("dropdown-option", option.value === value && "is-selected", index === activeIndex && "is-active")}
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelCombobox({ value, options, placeholder, onChange }) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, options.findIndex((option) => option.id === value)));
  const canOpen = options.length > 0;

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  const selectModel = (index) => {
    const model = options[index];
    if (!model) return;
    onChange(model.id);
    setActiveIndex(index);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!canOpen || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    if (!open) {
      if (event.key === "Enter") return;
      event.preventDefault();
      setOpen(true);
      return;
    }
    event.preventDefault();
    if (event.key === "ArrowDown") setActiveIndex((index) => (index + 1) % options.length);
    if (event.key === "ArrowUp") setActiveIndex((index) => (index - 1 + options.length) % options.length);
    if (event.key === "Enter") selectModel(activeIndex);
  };

  return (
    <div ref={rootRef} className={cx("custom-select", "model-combobox", open && "is-open")}>
      <input
        ref={inputRef}
        role="combobox"
        aria-label="模型 ID"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-autocomplete="list"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck="false"
        onFocus={() => canOpen && setOpen(true)}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          onChange(event.target.value);
          if (canOpen) setOpen(true);
        }}
      />
      <button
        className="combobox-toggle"
        type="button"
        aria-label={open ? "收起模型选项" : "展开模型选项"}
        aria-controls={listboxId}
        aria-expanded={open}
        disabled={!canOpen}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!canOpen) return;
          setOpen((current) => !current);
          inputRef.current?.focus();
        }}
      >
        <AppIcon src={selectChevronIcon} />
      </button>
      {open && canOpen && (
        <div id={listboxId} className="dropdown-menu" role="listbox" aria-label="模型 ID 选项">
          {options.map((model, index) => (
            <button
              className={cx("dropdown-option", model.id === value && "is-selected", index === activeIndex && "is-active")}
              type="button"
              role="option"
              aria-selected={model.id === value}
              title={model.label}
              key={model.id}
              onPointerEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectModel(index)}
            >
              {model.id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldLabel({ label, required, hint, children }) {
  const hintId = useId();
  const [hintOpen, setHintOpen] = useState(false);
  return (
    <div className="form-field">
      <span className="form-field-label">
        {required && <i>*</i>}{label}
        {hint && (
          <span className={cx("field-help", hintOpen && "is-open")} onMouseEnter={() => setHintOpen(true)} onMouseLeave={() => setHintOpen(false)}>
            <button type="button" aria-label={`查看${label}配置说明`} aria-describedby={hintId} onFocus={() => setHintOpen(true)} onBlur={() => setHintOpen(false)} onClick={() => setHintOpen(true)}>
              <AppIcon src={providerHelpIcon} />
            </button>
            <span id={hintId} className="field-help-popover" role="tooltip">{hint}</span>
          </span>
        )}
      </span>
      {children}
    </div>
  );
}

function ClearHistoryDialog({ onCancel, onConfirm }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialogRef.current?.querySelectorAll("button:not([disabled])") || []];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section ref={dialogRef} className="clear-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-history-title" aria-describedby="clear-history-description">
        <strong id="clear-history-title">清理全部历史？</strong>
        <p id="clear-history-description">将永久删除全部截图和 Prompt，且无法恢复。</p>
        <div><button ref={cancelRef} type="button" onClick={onCancel}>取消</button><button type="button" onClick={onConfirm}>确认清理</button></div>
      </section>
    </div>
  );
}
