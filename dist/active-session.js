export const ACTIVE_SESSION_KEY = "promptCaptureActiveSession";

const SESSION_PHASES = new Set(["idle", "required", "generating", "result", "error", "history", "settings"]);
const PROMPT_TYPES = new Set(["image", "style", "layout"]);

export const DEFAULT_ACTIVE_SESSION = Object.freeze({
  phase: "idle",
  previousPhase: "idle",
  activePrompt: "image",
  capture: null,
  record: null,
  error: "",
  updatedAt: 0,
});

function objectOrNull(value) {
  return value && typeof value === "object" ? value : null;
}

export function normalizeActiveSession(raw = {}) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    phase: SESSION_PHASES.has(value.phase) ? value.phase : DEFAULT_ACTIVE_SESSION.phase,
    previousPhase: SESSION_PHASES.has(value.previousPhase) ? value.previousPhase : DEFAULT_ACTIVE_SESSION.previousPhase,
    activePrompt: PROMPT_TYPES.has(value.activePrompt) ? value.activePrompt : DEFAULT_ACTIVE_SESSION.activePrompt,
    capture: objectOrNull(value.capture),
    record: objectOrNull(value.record),
    error: typeof value.error === "string" ? value.error : "",
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
  };
}

export function mergeActiveSession(current = {}, patch = {}, updatedAt = Date.now()) {
  return normalizeActiveSession({
    ...normalizeActiveSession(current),
    ...(patch && typeof patch === "object" ? patch : {}),
    updatedAt,
  });
}

function withoutImageData(value) {
  if (!value || typeof value !== "object") return null;
  return {
    ...value,
    screenshotDataUrl: "",
    thumbnailDataUrl: "",
  };
}

export function compactActiveSession(session = {}) {
  const normalized = normalizeActiveSession(session);
  return {
    ...normalized,
    capture: withoutImageData(normalized.capture),
    record: withoutImageData(normalized.record),
  };
}
