export const PROVIDER_IDS = {
  DASHSCOPE: "dashscope",
  VOLCENGINE: "volcengine",
  OPENAI_COMPATIBLE: "openai-compatible",
};

export const MODEL_PROVIDERS = {
  [PROVIDER_IDS.DASHSCOPE]: {
    id: PROVIDER_IDS.DASHSCOPE,
    label: "阿里云百炼",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    defaultModelId: "qwen3-vl-flash",
    models: [
      { id: "qwen3-vl-flash", label: "Qwen3-VL Flash" },
    ],
  },
  [PROVIDER_IDS.VOLCENGINE]: {
    id: PROVIDER_IDS.VOLCENGINE,
    label: "火山引擎方舟",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    defaultModelId: "doubao-seed-2-1-pro-260628",
    models: [
      { id: "doubao-seed-2-1-pro-260628", label: "Doubao Seed 2.1 Pro" },
    ],
  },
  [PROVIDER_IDS.OPENAI_COMPATIBLE]: {
    id: PROVIDER_IDS.OPENAI_COMPATIBLE,
    label: "OpenAI Compatible",
    endpoint: "",
    defaultModelId: "",
    models: [],
  },
};

export const DEFAULT_PROVIDER = PROVIDER_IDS.DASHSCOPE;
export const DEFAULT_MODEL = MODEL_PROVIDERS[DEFAULT_PROVIDER].defaultModelId;
export const DEFAULT_ENDPOINT = MODEL_PROVIDERS[DEFAULT_PROVIDER].endpoint;

const PROVIDER_ALIASES = {
  qwen: PROVIDER_IDS.DASHSCOPE,
  doubao: PROVIDER_IDS.VOLCENGINE,
  deepseek: PROVIDER_IDS.OPENAI_COMPATIBLE,
};

export function resolveProviderId(value) {
  const candidate = PROVIDER_ALIASES[value] || value;
  return MODEL_PROVIDERS[candidate] ? candidate : DEFAULT_PROVIDER;
}

export function getProvider(value) {
  return MODEL_PROVIDERS[resolveProviderId(value)];
}

export function createProviderProfile(settings = {}) {
  return {
    modelId: settings.modelId || "",
    apiKey: settings.apiKey || "",
    endpoint: settings.endpoint || "",
    apiTestStatus: settings.apiTestStatus || "idle",
  };
}

export function normalizeModelSettings(raw = {}) {
  const provider = resolveProviderId(raw.provider);
  const definition = getProvider(provider);
  const requiresRetest = raw.provider === "doubao" || raw.provider === "deepseek";
  const savedProfiles = raw.providerProfiles && typeof raw.providerProfiles === "object" ? raw.providerProfiles : {};
  const savedProfile = savedProfiles[provider] || {};
  const active = { ...raw, ...savedProfile };
  const profile = {
    modelId: active.modelId ?? definition.defaultModelId,
    apiKey: active.apiKey || "",
    endpoint: active.endpoint || active.apiBaseUrl || definition.endpoint,
    apiTestStatus: requiresRetest ? "idle" : active.apiTestStatus || "idle",
  };

  return {
    provider,
    ...profile,
    language: raw.language || "zh",
    providerProfiles: { ...savedProfiles, [provider]: profile },
  };
}

export function isModelSettingsReady(settings = {}) {
  return Boolean(
    MODEL_PROVIDERS[settings.provider]
      && settings.modelId?.trim()
      && settings.apiKey?.trim()
      && settings.endpoint?.trim()
      && settings.apiTestStatus === "success",
  );
}

export function validateModelSettings(settings = {}) {
  if (!MODEL_PROVIDERS[settings.provider]) return "请选择服务商";
  if (!settings.modelId?.trim()) return "请填写模型 ID";
  if (!settings.apiKey?.trim()) return "请填写 API Key";
  if (!settings.endpoint?.trim()) return "请填写接口地址";
  try {
    const url = new URL(settings.endpoint.trim());
    if (!/^https?:$/.test(url.protocol)) return "接口地址仅支持 HTTP 或 HTTPS";
  } catch {
    return "接口地址格式不正确";
  }
  return "";
}
