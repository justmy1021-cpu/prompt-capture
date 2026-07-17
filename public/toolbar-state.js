export const TOOLBAR_STATE_KEY = "promptCaptureToolbarEnabled";

export function nextToolbarEnabled(value) {
  return value !== true;
}

export function isToolbarSupportedUrl(url = "") {
  return /^(https?|file):\/\//.test(String(url));
}
