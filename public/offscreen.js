chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "prompt-capture/offscreen-copy-text") return false;
  const value = String(message.text || "");
  const target = document.getElementById("clipboard-target");
  if (!value || !target) {
    sendResponse({ ok: false, error: value ? "剪贴板通道未就绪" : "没有可复制的提示词" });
    return false;
  }
  void (async () => {
    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(value);
          sendResponse({ ok: true });
          return;
        } catch {
          // Clipboard API 不可用时继续使用离屏文档选区复制。
        }
      }
      target.value = value;
      target.focus();
      target.select();
      target.setSelectionRange(0, target.value.length);
      const ok = document.execCommand("copy");
      target.value = "";
      if (!ok) throw new Error("浏览器拒绝了复制操作");
      sendResponse({ ok: true });
    } catch (error) {
      target.value = "";
      sendResponse({ ok: false, error: error?.message || "复制失败" });
    }
  })();
  return true;
});
