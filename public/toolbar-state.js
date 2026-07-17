export const TOOLBAR_STATE_KEY = "promptCaptureToolbarEnabled";
export const TOOLBAR_POSITION_KEY = "promptCaptureToolbarPosition";

export function nextToolbarEnabled(value) {
  return value !== true;
}

export function isToolbarSupportedUrl(url = "") {
  return /^(https?|file):\/\//.test(String(url));
}

export function resolveToolbarTargetTabId(tabs = [], focusedWindowId) {
  const target = tabs.find((tab) => (
    Number.isInteger(tab?.id)
      && tab.windowId === focusedWindowId
      && tab.active === true
      && isToolbarSupportedUrl(tab.url)
  ));
  return target?.id ?? null;
}
