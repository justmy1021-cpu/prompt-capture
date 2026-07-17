(function initPromptCaptureToolbar() {
  const VERSION = "2026-07-17-selection-border-v14";
  const extensionApi = chrome;
  if (window.__promptCaptureToolbarVersion === VERSION) return;
  window.__promptCaptureToolbarVersion = VERSION;

  const MESSAGE = {
    TOGGLE_TOOLBAR: "prompt-capture/toggle-toolbar-v7",
    SHOW_TOOLBAR: "prompt-capture/show-toolbar-v7",
    START_SHORTCUT: "prompt-capture/start-shortcut-v7",
    CAPTURE_SELECTION: "prompt-capture/capture-selection-v7",
    CAPTURE_AND_GENERATE: "prompt-capture/capture-and-generate-v7",
    GENERATE_FROM_CAPTURE: "prompt-capture/generate-from-capture-v7",
    COPY_TEXT_ON_PAGE: "prompt-capture/copy-text-on-page",
  };
  const SETTINGS_KEY = "promptCaptureSettings";
  const POSITION_KEY = "promptCaptureToolbarPosition";
  let toolbarFrame = null;
  let dragHandle = null;
  let toolbarVisible = false;
  let toolbarReady = false;
  let selection = null;
  let drag = null;
  let dragShield = null;
  let currentToolbarHeight = 100;
  let hasCustomPosition = false;
  let shadowRestoreTimer = null;

  removeStaleOverlayNodes();
  installOverlayStyles();
  window.addEventListener("resize", () => resizeToolbar(currentToolbarHeight));

  function removeStaleOverlayNodes() {
    document.querySelectorAll(".pc-toolbar-frame, .pc-toolbar-drag-handle, .pc-drag-shield, .pc-capture-layer").forEach((node) => node.remove());
  }

  extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type) return false;
    if (message.type === MESSAGE.TOGGLE_TOOLBAR) {
      if (toolbarVisible) hideToolbar();
      else showToolbar();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === MESSAGE.SHOW_TOOLBAR) {
      showToolbar();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === MESSAGE.START_SHORTCUT) {
      startShortcutSelection().then((response) => sendResponse(response));
      return true;
    }
    if (message.type === MESSAGE.COPY_TEXT_ON_PAGE) {
      copyText(message.text).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: error?.message || "复制失败" }),
      );
      return true;
    }
    return false;
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!toolbarFrame || event.source !== toolbarFrame.contentWindow || message?.channel !== "prompt-capture") return;
    const payload = message.payload || {};
    if (message.type === "PC_RESIZE") resizeToolbar(payload.height);
    if (message.type === "PC_HIDE_TOOLBAR") hideToolbar();
    if (message.type === "PC_START_SELECTION") startSelection(payload.mode);
    if (message.type === "PC_RESELECT") clearSelection();
    if (message.type === "PC_CONFIRM_SELECTION") confirmSelection();
    if (message.type === "PC_RETRY_GENERATION") retryGeneration(payload.capture);
    if (message.type === "PC_IMAGE_KEY") handleImageKey(payload.key);
    if (message.type === "PC_DRAG_START") beginDrag(payload);
    if (message.type === "PC_DRAG_MOVE") moveDragFromToolbar(payload);
    if (message.type === "PC_DRAG_END") endDrag();
    if (message.type === "PC_NAVIGATION_MOTION") {
      toolbarFrame.classList.toggle("pc-toolbar-frame--flipping", Boolean(payload.active));
    }
    if (message.type === "PC_COPY_TEXT") {
      void copyText(payload.text).then(
        () => postToToolbar("PC_COPY_RESULT", { requestId: payload.requestId, ok: true }),
        (error) => postToToolbar("PC_COPY_RESULT", { requestId: payload.requestId, ok: false, error: error?.message || "复制失败" }),
      );
    }
  });

  function ensureToolbar() {
    if (toolbarFrame?.isConnected) return;
    toolbarFrame = document.createElement("iframe");
    toolbarFrame.className = "pc-toolbar-frame";
    toolbarFrame.title = "Prompt Capture";
    toolbarFrame.setAttribute("aria-label", "Prompt Capture 悬浮工具栏");
    toolbarFrame.src = extensionApi.runtime.getURL("index.html?embed=toolbar");
    toolbarFrame.style.display = "none";
    toolbarFrame.addEventListener("load", () => {
      toolbarReady = true;
      postToToolbar("PC_SHOW_TOOLBAR");
      syncDragHandle();
    });
    document.documentElement.appendChild(toolbarFrame);

    dragHandle = document.createElement("div");
    dragHandle.className = "pc-toolbar-drag-handle";
    dragHandle.setAttribute("aria-hidden", "true");
    dragHandle.addEventListener("pointerdown", beginHostDrag, true);
    dragHandle.addEventListener("pointermove", moveDrag, true);
    dragHandle.addEventListener("pointerup", endDrag, true);
    dragHandle.addEventListener("pointercancel", endDrag, true);
    document.documentElement.appendChild(dragHandle);
    syncDragHandle();
    void restoreToolbarPosition();
  }

  function showToolbar() {
    ensureToolbar();
    toolbarVisible = true;
    toolbarFrame.style.display = "block";
    toolbarFrame.style.visibility = "visible";
    if (dragHandle) dragHandle.style.display = "block";
    syncDragHandle();
    postToToolbar("PC_SHOW_TOOLBAR");
  }

  function hideToolbar() {
    endDrag();
    clearSelection(true);
    if (toolbarFrame) toolbarFrame.style.display = "none";
    if (dragHandle) dragHandle.style.display = "none";
    toolbarVisible = false;
  }

  function resizeToolbar(rawHeight) {
    if (!toolbarFrame) return;
    const height = Number(rawHeight) || 100;
    const width = Math.min(360, Math.max(280, window.innerWidth - 16));
    if (height !== currentToolbarHeight) suppressFrameShadowDuringResize();
    currentToolbarHeight = height;
    toolbarFrame.style.setProperty("--pc-width", `${width}px`);
    toolbarFrame.style.setProperty("--pc-height", `${Math.min(height, Math.max(100, window.innerHeight - 16))}px`);
    clampToolbarPosition();
    syncDragHandle();
  }

  function suppressFrameShadowDuringResize() {
    toolbarFrame?.classList.add("pc-toolbar-frame--resizing");
    if (shadowRestoreTimer) window.clearTimeout(shadowRestoreTimer);
    shadowRestoreTimer = window.setTimeout(() => {
      toolbarFrame?.classList.remove("pc-toolbar-frame--resizing");
      shadowRestoreTimer = null;
    }, 240);
  }

  function postToToolbar(type, payload = {}) {
    if (!toolbarFrame || !toolbarReady) return;
    toolbarFrame.contentWindow?.postMessage({ channel: "prompt-capture", type, payload }, "*");
  }

  async function startShortcutSelection() {
    showToolbar();
    const stored = await extensionApi.storage.local.get(SETTINGS_KEY);
    if (!settingsComplete(stored[SETTINGS_KEY])) {
      postToToolbar("PC_FORCE_REQUIRED");
      return { ok: false, error: "请完成模型设置并通过连接测试" };
    }
    startSelection("region");
    return { ok: true };
  }

  function settingsComplete(raw = {}) {
    return Boolean(raw?.provider && raw?.modelId?.trim() && raw?.apiKey?.trim() && raw?.endpoint?.trim() && raw?.apiTestStatus === "success");
  }

  function beginDrag(payload) {
    if (!toolbarFrame) return;
    endDrag();
    const rect = toolbarFrame.getBoundingClientRect();
    const localX = clamp(Number(payload.clientX ?? payload.x) || 0, 0, rect.width);
    const localY = clamp(Number(payload.clientY ?? payload.y) || 0, 0, rect.height);
    drag = {
      pointerId: payload.pointerId,
      pointerClientX: rect.left + localX,
      pointerClientY: rect.top + localY,
    };
    hasCustomPosition = true;
    toolbarFrame.style.setProperty("--pc-left", `${rect.left}px`);
    toolbarFrame.style.setProperty("--pc-top", `${rect.top}px`);
    toolbarFrame.style.setProperty("--pc-right", "auto");
    toolbarFrame.classList.add("pc-toolbar-frame--dragging");
    dragHandle?.classList.add("pc-toolbar-drag-handle--dragging");
    syncDragHandle();

    dragShield = document.createElement("div");
    dragShield.className = "pc-drag-shield";
    dragShield.setAttribute("aria-hidden", "true");
    dragShield.addEventListener("pointermove", moveDrag, true);
    dragShield.addEventListener("pointerup", endDrag, true);
    dragShield.addEventListener("pointercancel", endDrag, true);
    document.documentElement.appendChild(dragShield);
    window.addEventListener("blur", endDrag, { once: true });
    window.addEventListener("pointerup", endDrag, true);
    window.addEventListener("pointercancel", endDrag, true);
  }

  function beginHostDrag(event) {
    if (!toolbarFrame || event.button !== 0) return;
    event.preventDefault();
    const rect = toolbarFrame.getBoundingClientRect();
    beginDrag({
      pointerId: event.pointerId,
      clientX: event.clientX - rect.left,
      clientY: event.clientY - rect.top,
    });
    dragHandle?.setPointerCapture?.(event.pointerId);
  }

  function moveDrag(event) {
    if (!drag || !toolbarFrame) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      endDrag(event);
      return;
    }
    event.preventDefault();
    const deltaX = event.clientX - drag.pointerClientX;
    const deltaY = event.clientY - drag.pointerClientY;
    drag.pointerClientX = event.clientX;
    drag.pointerClientY = event.clientY;
    moveToolbarBy(deltaX, deltaY);
  }

  function moveDragFromToolbar(payload) {
    if (!drag || !toolbarFrame) return;
    if (drag.pointerId != null && payload.pointerId != null && drag.pointerId !== payload.pointerId) return;
    const deltaX = Number(payload.movementX);
    const deltaY = Number(payload.movementY);
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
    drag.pointerClientX += deltaX;
    drag.pointerClientY += deltaY;
    moveToolbarBy(deltaX, deltaY);
  }

  function moveToolbarBy(deltaX, deltaY) {
    if (!toolbarFrame || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
    const rect = toolbarFrame.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    const left = clamp(rect.left + deltaX, 8, maxLeft);
    const top = clamp(rect.top + deltaY, 8, maxTop);
    toolbarFrame.style.setProperty("--pc-left", `${left}px`);
    toolbarFrame.style.setProperty("--pc-top", `${top}px`);
    syncDragHandle();
  }

  function endDrag(event) {
    if (event?.cancelable) event.preventDefault();
    const hadDrag = Boolean(drag);
    drag = null;
    window.removeEventListener("blur", endDrag);
    window.removeEventListener("pointerup", endDrag, true);
    window.removeEventListener("pointercancel", endDrag, true);
    if (dragShield) {
      dragShield.removeEventListener("pointermove", moveDrag, true);
      dragShield.removeEventListener("pointerup", endDrag, true);
      dragShield.removeEventListener("pointercancel", endDrag, true);
      dragShield.remove();
      dragShield = null;
    }
    toolbarFrame?.classList.remove("pc-toolbar-frame--dragging");
    dragHandle?.classList.remove("pc-toolbar-drag-handle--dragging");
    syncDragHandle();
    if (hadDrag && toolbarFrame) {
      const rect = toolbarFrame.getBoundingClientRect();
      void extensionApi.storage.local.set({ [POSITION_KEY]: { left: Math.round(rect.left), top: Math.round(rect.top) } });
    }
  }

  async function restoreToolbarPosition() {
    try {
      const stored = await extensionApi.storage.local.get(POSITION_KEY);
      const position = stored[POSITION_KEY];
      if (!toolbarFrame?.isConnected || !Number.isFinite(position?.left) || !Number.isFinite(position?.top)) return;
      hasCustomPosition = true;
      toolbarFrame.style.setProperty("--pc-left", `${position.left}px`);
      toolbarFrame.style.setProperty("--pc-top", `${position.top}px`);
      toolbarFrame.style.setProperty("--pc-right", "auto");
      clampToolbarPosition();
      syncDragHandle();
    } catch {
      // 存储不可用时仍允许在当前页面内拖动。
    }
  }

  function clampToolbarPosition() {
    if (!toolbarFrame || !hasCustomPosition) return;
    const rect = toolbarFrame.getBoundingClientRect();
    toolbarFrame.style.setProperty("--pc-left", `${clamp(rect.left, 8, Math.max(8, window.innerWidth - rect.width - 8))}px`);
    toolbarFrame.style.setProperty("--pc-top", `${clamp(rect.top, 8, Math.max(8, window.innerHeight - rect.height - 8))}px`);
    syncDragHandle();
  }

  function syncDragHandle() {
    if (!toolbarFrame || !dragHandle) return;
    const rect = toolbarFrame.getBoundingClientRect();
    const leftInset = 44;
    const rightInset = 112;
    dragHandle.style.left = `${rect.left + leftInset}px`;
    dragHandle.style.top = `${rect.top}px`;
    dragHandle.style.width = `${Math.max(72, rect.width - leftInset - rightInset)}px`;
    dragHandle.style.height = `${Math.min(48, rect.height)}px`;
  }

  function startSelection(mode) {
    if (mode !== "page" && mode !== "image" && mode !== "region") return;
    showToolbar();
    clearSelection();
    if (mode === "page") void captureCurrentPageCandidate();
    else if (mode === "image") startImageSelection();
    else startRegionSelection();
  }

  async function captureCurrentPageCandidate() {
    const layer = createSelectionLayer("page");
    const outline = document.createElement("div");
    outline.className = "pc-page-outline";
    layer.style.pointerEvents = "none";
    layer.appendChild(outline);
    const rect = {
      x: 0,
      y: 0,
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
      type: "page",
      devicePixelRatio: window.devicePixelRatio || 1,
      title: document.title,
      url: location.href,
    };
    selection = { type: "page", rect, layer, outline, candidate: false, confirming: true, listeners: [] };
    try {
      const screenshotDataUrl = await captureSelectionImage(rect);
      if (!selection || selection.type !== "page") return;
      selection.screenshotDataUrl = screenshotDataUrl;
      selection.candidate = true;
      selection.confirming = false;
      postToToolbar("PC_SELECTION_CANDIDATE", { ...rect, screenshotDataUrl });
    } catch (error) {
      selection = null;
      postToToolbar("PC_GENERATION_ERROR", { error: error?.message || "当前页面截图失败", screenshotDataUrl: "", selection: rect });
    }
  }

  function startRegionSelection() {
    const layer = createSelectionLayer("region");
    const box = document.createElement("div");
    const size = document.createElement("div");
    box.className = "pc-selection-box";
    size.className = "pc-selection-size";
    size.hidden = true;
    layer.append(box, size);
    selection = { type: "region", layer, box, size, rect: null, candidate: false, listeners: [] };
    let start = null;

    const onPointerDown = (event) => {
      if (event.button !== 0 || selection?.candidate) return;
      event.preventDefault();
      layer.setPointerCapture?.(event.pointerId);
      start = { x: event.clientX, y: event.clientY };
      updateRegion(event.clientX, event.clientY);
    };
    const onPointerMove = (event) => {
      if (!start || selection?.candidate) return;
      event.preventDefault();
      updateRegion(event.clientX, event.clientY);
    };
    const onPointerUp = (event) => {
      if (!start || selection?.candidate) return;
      event.preventDefault();
      updateRegion(event.clientX, event.clientY);
      start = null;
      if (!selection?.rect || selection.rect.width < 32 || selection.rect.height < 32) {
        selection.size.textContent = "选区至少需要 32 × 32";
        return;
      }
      setCandidate(selection.rect);
    };
    selection.update = (x, y) => {
      const left = Math.min(start.x, x);
      const top = Math.min(start.y, y);
      const width = Math.abs(x - start.x);
      const height = Math.abs(y - start.y);
      selection.rect = { x: Math.round(left), y: Math.round(top), width: Math.round(width), height: Math.round(height), type: "region", devicePixelRatio: window.devicePixelRatio || 1, title: document.title, url: location.href };
      Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      size.hidden = false;
      size.textContent = `${Math.round(width)} × ${Math.round(height)}`;
      Object.assign(size.style, { left: `${left}px`, top: `${Math.max(8, top - 28)}px` });
    };
    layer.addEventListener("pointerdown", onPointerDown);
    layer.addEventListener("pointermove", onPointerMove);
    layer.addEventListener("pointerup", onPointerUp);
    selection.listeners.push([layer, "pointerdown", onPointerDown], [layer, "pointermove", onPointerMove], [layer, "pointerup", onPointerUp]);
    lockPage();
  }

  function updateRegion(x, y) {
    selection?.update?.(x, y);
  }

  function startImageSelection() {
    const layer = createSelectionLayer("image");
    const outline = document.createElement("div");
    outline.className = "pc-image-outline";
    outline.hidden = true;
    layer.appendChild(outline);
    layer.style.pointerEvents = "none";
    selection = { type: "image", layer, outline, rect: null, candidate: false, listeners: [], candidates: [], candidateIndex: -1 };

    const clearImageTarget = () => {
      outline.hidden = true;
      selection.rect = null;
      selection.candidateIndex = -1;
    };

    const highlightImageTarget = (target) => {
      const rect = getImageSelectionRect(target);
      if (!rect) {
        clearImageTarget();
        return false;
      }
      selection.rect = rect;
      selection.candidateIndex = selection.candidates.indexOf(target);
      Object.assign(outline.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      outline.hidden = false;
      return true;
    };

    selection.highlightImageTarget = highlightImageTarget;
    selection.clearImageTarget = clearImageTarget;
    selection.candidates = getImageCandidates();
    if (selection.candidates.length) {
      highlightImageTarget(selection.candidates[0]);
      postToToolbar("PC_SELECTION_HINT", { text: `已找到 ${selection.candidates.length} 个可选图片。使用方向键切换，Enter 选择，Esc 取消。` });
    } else {
      postToToolbar("PC_SELECTION_HINT", { text: "当前可视区域没有可选图片。可改用框选截图，按 Escape 取消。" });
    }

    const onPointerMove = (event) => {
      const target = getImageTarget(event.target);
      highlightImageTarget(target);
    };
    const onClick = (event) => {
      const target = getImageTarget(event.target);
      if (!target || selection?.candidate || !highlightImageTarget(target) || !selection?.rect) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      setCandidate(selection.rect);
    };
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("click", onClick, true);
    selection.listeners.push([document, "pointermove", onPointerMove, true], [document, "click", onClick, true]);
    lockPage();
  }

  function handleImageKey(key) {
    if (selection?.type !== "image" || selection.candidate) return;
    if (key === "Escape") {
      clearSelection(true);
      return;
    }
    if (key === "Enter") {
      if (selection.rect) setCandidate(selection.rect);
      return;
    }
    if (!["ArrowLeft", "ArrowRight"].includes(key)) return;
    selection.candidates = selection.candidates.filter((target) => target.isConnected && getImageSelectionRect(target));
    if (!selection.candidates.length) {
      selection.clearImageTarget?.();
      postToToolbar("PC_SELECTION_HINT", { text: "当前没有可选图片。可改用框选截图，按 Escape 取消。" });
      return;
    }
    const currentIndex = Math.max(0, selection.candidateIndex);
    const nextIndex = (currentIndex + (key === "ArrowRight" ? 1 : -1) + selection.candidates.length) % selection.candidates.length;
    selection.highlightImageTarget?.(selection.candidates[nextIndex]);
    postToToolbar("PC_SELECTION_HINT", { text: `已选中第 ${nextIndex + 1} 个候选图片，共 ${selection.candidates.length} 个。按 Enter 选择。` });
  }

  function getImageTarget(start) {
    let element = start instanceof Element ? start : null;
    for (let depth = 0; element && depth < 10; depth += 1, element = element.parentElement) {
      if (element.tagName === "IMG") return element;
      if (element.tagName === "PICTURE") return element.querySelector("img") || element;
      if (element !== document.body && element !== document.documentElement && getComputedStyle(element).backgroundImage !== "none") return element;
    }
    return null;
  }

  function getImageCandidates() {
    const seen = new Set();
    return [...document.querySelectorAll("img, picture, [style*='background-image']")]
      .map((node) => getImageTarget(node))
      .filter((node) => node && !seen.has(node) && (seen.add(node), true))
      .filter((node) => Boolean(getImageSelectionRect(node)));
  }

  function getImageSelectionRect(target) {
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    const left = clamp(rect.left, 0, window.innerWidth);
    const top = clamp(rect.top, 0, window.innerHeight);
    const right = clamp(rect.right, 0, window.innerWidth);
    const bottom = clamp(rect.bottom, 0, window.innerHeight);
    const width = Math.round(right - left);
    const height = Math.round(bottom - top);
    if (width < 32 || height < 32) return null;
    return { x: Math.round(left), y: Math.round(top), width, height, type: "image", devicePixelRatio: window.devicePixelRatio || 1, title: document.title, url: location.href };
  }

  function setCandidate(rect) {
    if (!selection || !rect) return;
    selection.candidate = true;
    removeSelectionListeners();
    selection.layer.style.pointerEvents = "none";
    postToToolbar("PC_SELECTION_CANDIDATE", rect);
  }

  async function confirmSelection() {
    if (!selection?.candidate || selection.confirming) return;
    const activeSelection = selection;
    const snapshot = activeSelection.rect;
    selection.confirming = true;
    removeSelectionDom();
    unlockPage();
    let screenshotDataUrl = activeSelection.screenshotDataUrl || snapshot?.screenshotDataUrl || "";
    try {
      if (!screenshotDataUrl) screenshotDataUrl = await captureSelectionImage(snapshot);
      const capture = {
        screenshotDataUrl,
        selectionType: snapshot.type || "region",
        source: { title: snapshot.title || document.title, url: snapshot.url || location.href },
      };
      postToToolbar("PC_CAPTURE_READY", { capture });
      const response = await extensionApi.runtime.sendMessage({ type: MESSAGE.GENERATE_FROM_CAPTURE, capture });
      if (!response?.ok) throw Object.assign(new Error(response?.error || "生成失败"), { screenshotDataUrl: response?.screenshotDataUrl || screenshotDataUrl });
      postToToolbar("PC_GENERATION_SUCCESS", { record: response.record });
    } catch (error) {
      postToToolbar("PC_GENERATION_ERROR", { error: error?.message || "生成失败", screenshotDataUrl: error?.screenshotDataUrl || screenshotDataUrl, selection: snapshot });
    } finally {
      selection = null;
    }
  }

  async function captureSelectionImage(snapshot) {
    setToolbarCaptureVisibility(false);
    await wait(80);
    try {
      const response = await extensionApi.runtime.sendMessage({ type: MESSAGE.CAPTURE_SELECTION, selection: snapshot });
      if (!response?.ok || !response.screenshotDataUrl) throw new Error(response?.error || "截图失败");
      return response.screenshotDataUrl;
    } finally {
      setToolbarCaptureVisibility(true);
    }
  }

  function setToolbarCaptureVisibility(visible) {
    const visibility = visible ? "visible" : "hidden";
    if (toolbarFrame) toolbarFrame.style.visibility = visibility;
    if (dragHandle) dragHandle.style.visibility = visibility;
    if (selection?.layer) selection.layer.style.visibility = visibility;
  }

  async function retryGeneration(capture) {
    if (!capture?.screenshotDataUrl) {
      postToToolbar("PC_GENERATION_ERROR", { error: "原截图不可用，请重新选择后生成。", screenshotDataUrl: "", selection: capture?.selection || null });
      return;
    }
    try {
      const response = await extensionApi.runtime.sendMessage({ type: MESSAGE.GENERATE_FROM_CAPTURE, capture });
      if (!response?.ok) throw Object.assign(new Error(response?.error || "生成失败"), { screenshotDataUrl: response?.screenshotDataUrl || capture.screenshotDataUrl });
      postToToolbar("PC_GENERATION_SUCCESS", { record: response.record });
    } catch (error) {
      postToToolbar("PC_GENERATION_ERROR", {
        error: error?.message || "生成失败",
        screenshotDataUrl: error?.screenshotDataUrl || capture.screenshotDataUrl,
        selection: {
          type: capture.selectionType || "region",
          title: capture.source?.title || document.title,
          url: capture.source?.url || location.href,
        },
      });
    }
  }

  function clearSelection(announce = false) {
    const hadSelection = Boolean(selection);
    removeSelectionListeners();
    removeSelectionDom();
    unlockPage();
    selection = null;
    if (announce && hadSelection) postToToolbar("PC_SELECTION_CANCELLED");
  }

  function createSelectionLayer(mode) {
    const layer = document.createElement("div");
    layer.className = `pc-capture-layer pc-capture-layer--${mode}`;
    document.documentElement.appendChild(layer);
    return layer;
  }

  function removeSelectionListeners() {
    if (!selection?.listeners) return;
    selection.listeners.forEach(([target, name, handler, capture]) => target.removeEventListener(name, handler, capture));
    selection.listeners = [];
  }

  function removeSelectionDom() {
    selection?.layer?.remove();
    document.querySelectorAll(".pc-capture-layer").forEach((node) => node.remove());
  }

  let locked = false;
  const preventScroll = (event) => event.preventDefault();
  const preventKeys = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      clearSelection(true);
      return;
    }
    if ([" ", "ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) event.preventDefault();
  };

  function lockPage() {
    if (locked) return;
    locked = true;
    document.addEventListener("wheel", preventScroll, { capture: true, passive: false });
    document.addEventListener("touchmove", preventScroll, { capture: true, passive: false });
    window.addEventListener("keydown", preventKeys, true);
  }

  function unlockPage() {
    if (!locked) return;
    locked = false;
    document.removeEventListener("wheel", preventScroll, true);
    document.removeEventListener("touchmove", preventScroll, true);
    window.removeEventListener("keydown", preventKeys, true);
  }

  async function copyText(value) {
    const text = String(value || "");
    if (!text) throw new Error("没有可复制的提示词");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      // 当前网页拒绝 Clipboard API 时继续使用兼容复制。
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.cssText = "position:fixed!important;left:-9999px!important;top:0!important;opacity:0!important;pointer-events:none!important";
    document.documentElement.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand("copy");
    textarea.remove();
    if (!ok) throw new Error("浏览器拒绝了复制操作");
  }

  function installOverlayStyles() {
    const style = document.getElementById("pc-floating-toolbar-style") || document.createElement("style");
    style.id = "pc-floating-toolbar-style";
    style.textContent = `
      .pc-toolbar-frame {
        position: fixed !important;
        top: var(--pc-top, 16px);
        right: var(--pc-right, 16px);
        left: var(--pc-left, auto);
        z-index: 2147483647 !important;
        width: var(--pc-width, 360px);
        height: var(--pc-height, 100px);
        overflow: hidden !important;
        border: 0 !important;
        border-radius: 12px !important;
        outline: 0 !important;
        background: transparent !important;
        color-scheme: dark !important;
        box-shadow: 0 8px 22px rgba(0, 0, 0, .32), 0 24px 60px rgba(0, 0, 0, .38) !important;
        filter: none !important;
        pointer-events: auto !important;
        transition: height 180ms ease !important;
      }
      .pc-toolbar-frame--dragging {
        cursor: grabbing !important;
      }
      .pc-toolbar-frame--flipping,
      .pc-toolbar-frame--resizing {
        box-shadow: none !important;
      }
      .pc-toolbar-frame--flipping {
        transition: none !important;
      }
      .pc-toolbar-drag-handle {
        position: fixed !important;
        z-index: 2147483647 !important;
        display: none;
        margin: 0 !important;
        padding: 0 !important;
        cursor: grab !important;
        background: transparent !important;
        border: 0 !important;
        outline: 0 !important;
        user-select: none !important;
        touch-action: none !important;
      }
      .pc-toolbar-drag-handle--dragging {
        cursor: grabbing !important;
      }
      .pc-drag-shield {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483646 !important;
        display: block !important;
        margin: 0 !important;
        padding: 0 !important;
        cursor: grabbing !important;
        background: rgba(0, 0, 0, .001) !important;
        border: 0 !important;
        outline: 0 !important;
        user-select: none !important;
        touch-action: none !important;
      }
      .pc-capture-layer {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483646 !important;
        cursor: crosshair !important;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif !important;
      }
      .pc-selection-box {
        position: absolute !important;
        display: block !important;
        box-sizing: border-box !important;
        border: 2px dashed #ff5e1d !important;
        background: rgba(255, 94, 29, .08) !important;
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, .34) !important;
        pointer-events: none !important;
      }
      .pc-selection-size {
        position: absolute !important;
        z-index: 1 !important;
        padding: 4px 7px !important;
        color: #fff !important;
        background: #191919 !important;
        border: 1px solid #383737 !important;
        border-radius: 4px !important;
        font-size: 12px !important;
        line-height: 16px !important;
        pointer-events: none !important;
      }
      .pc-image-outline {
        position: fixed !important;
        z-index: 1 !important;
        box-sizing: border-box !important;
        border: 2px dashed #ff5e1d !important;
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, .18) !important;
        pointer-events: none !important;
      }
      .pc-page-outline {
        position: fixed !important;
        inset: 4px !important;
        z-index: 1 !important;
        display: block !important;
        box-sizing: border-box !important;
        border: 2px dashed #ff5e1d !important;
        background: rgba(255, 94, 29, .04) !important;
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .2) !important;
        pointer-events: none !important;
      }
    `;
    if (!style.isConnected) document.documentElement.appendChild(style);
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }
})();
