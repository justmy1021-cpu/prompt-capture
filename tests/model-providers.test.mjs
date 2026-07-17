import test from "node:test";
import assert from "node:assert/strict";

import {
  MODEL_PROVIDERS,
  getProvider,
  isModelSettingsReady,
  normalizeModelSettings,
  validateModelSettings,
} from "../src/model-providers.js";

test("内置百炼、火山方舟和 OpenAI Compatible 三类服务商", () => {
  assert.deepEqual(Object.keys(MODEL_PROVIDERS), ["dashscope", "volcengine", "openai-compatible"]);
  const volcengine = getProvider("volcengine");
  assert.match(volcengine.endpoint, /ark\.cn-beijing\.volces\.com/);
  assert.equal(volcengine.defaultModelId, "doubao-seed-2-1-pro-260628");
  assert.deepEqual(volcengine.models, [
    { id: "doubao-seed-2-1-pro-260628", label: "Doubao Seed 2.1 Pro" },
  ]);
});

test("旧 qwen 配置迁移到百炼并补全原接口地址", () => {
  const settings = normalizeModelSettings({
    provider: "qwen",
    modelId: "qwen3-vl-flash",
    apiKey: "test-key",
    apiTestStatus: "success",
  });

  assert.equal(settings.provider, "dashscope");
  assert.match(settings.endpoint, /dashscope\.aliyuncs\.com/);
  assert.equal(settings.apiTestStatus, "success");
});

test("模型配置必须通过真实连接测试后才算可用", () => {
  const settings = normalizeModelSettings({ apiKey: "test-key" });
  assert.equal(isModelSettingsReady(settings), false);
  assert.equal(isModelSettingsReady({ ...settings, apiTestStatus: "success" }), true);
});

test("按服务商恢复各自保存的模型与密钥配置", () => {
  const settings = normalizeModelSettings({
    provider: "volcengine",
    language: "zh",
    providerProfiles: {
      volcengine: {
        modelId: "ep-user-endpoint",
        apiKey: "volc-key",
        endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
        apiTestStatus: "success",
      },
    },
  });

  assert.equal(settings.modelId, "ep-user-endpoint");
  assert.equal(settings.apiKey, "volc-key");
  assert.equal(settings.apiTestStatus, "success");
});

test("校验服务商、模型、密钥和 HTTP 接口地址", () => {
  assert.equal(validateModelSettings({ provider: "dashscope" }), "请填写模型 ID");
  assert.equal(validateModelSettings({ provider: "dashscope", modelId: "model", apiKey: "key", endpoint: "not-a-url" }), "接口地址格式不正确");
  assert.equal(validateModelSettings({ provider: "dashscope", modelId: "model", apiKey: "key", endpoint: "https://example.com/v1/chat/completions" }), "");
});
