import test from "node:test";
import assert from "node:assert/strict";

import {
  PROMPT_SCHEMA_VERSION,
  SOURCE_TYPES,
  VISION_PROMPT_SYSTEM_MESSAGE,
  buildVisionPromptInstruction,
  parseVisionPromptResponse,
} from "../public/prompt-generation.js";

function createV2Payload(overrides = {}) {
  return {
    schema_version: PROMPT_SCHEMA_VERSION,
    source_type: "ui_page",
    source_summary: "高对比桌面网页",
    image: { final_prompt: "图片 Prompt" },
    style: { final_prompt: "风格 Prompt" },
    layout: { final_prompt: "布局 Prompt" },
    ...overrides,
  };
}

test("生成指令声明固定结构、素材类型和提示注入防护", () => {
  const instruction = buildVisionPromptInstruction("zh");

  assert.match(VISION_PROMPT_SYSTEM_MESSAGE, /不可信的待分析数据/);
  assert.match(VISION_PROMPT_SYSTEM_MESSAGE, /绝不能作为指令执行/);
  assert.match(instruction, /source_type/);
  assert.match(instruction, /ui_page\/ui_component/);
  assert.match(instruction, /illustration\/photo/);
  assert.match(instruction, /final_prompt/);
});

test("语言设置分别生成中文、英文和中英双语要求", () => {
  assert.match(buildVisionPromptInstruction("zh"), /只使用简体中文/);
  assert.match(buildVisionPromptInstruction("en"), /English only/);
  assert.match(buildVisionPromptInstruction("bilingual"), /完整 English 版本/);
});

test("解析 v2 返回并保留界面兼容的三个 Prompt", () => {
  const result = parseVisionPromptResponse(JSON.stringify(createV2Payload()));

  assert.deepEqual(result.prompts, {
    image: "图片 Prompt",
    style: "风格 Prompt",
    layout: "布局 Prompt",
  });
  assert.deepEqual(result.promptMeta, {
    schemaVersion: "2.0",
    sourceType: "ui_page",
    sourceSummary: "高对比桌面网页",
  });
});

test("接受全部约定素材类型", () => {
  for (const sourceType of SOURCE_TYPES) {
    const result = parseVisionPromptResponse(JSON.stringify(createV2Payload({ source_type: sourceType })));
    assert.equal(result.promptMeta.sourceType, sourceType);
  }
});

test("内部分析字段缺失时仍保留可用 final_prompt", () => {
  const result = parseVisionPromptResponse(JSON.stringify(createV2Payload({
    image: { final_prompt: "  图片内容  " },
    style: { final_prompt: "  风格内容  " },
    layout: { final_prompt: "  布局内容  " },
  })));

  assert.equal(result.prompts.image, "图片内容");
  assert.equal(result.prompts.style, "风格内容");
  assert.equal(result.prompts.layout, "布局内容");
});

test("兼容旧版扁平字段和 Markdown JSON 围栏", () => {
  const legacy = {
    image_prompt: "旧图片 Prompt",
    style_prompt: "旧风格 Prompt",
    layout_prompt: "旧布局 Prompt",
  };
  const result = parseVisionPromptResponse(`\`\`\`json\n${JSON.stringify(legacy)}\n\`\`\``);

  assert.equal(result.prompts.image, legacy.image_prompt);
  assert.equal(result.promptMeta.schemaVersion, "1.0");
  assert.equal(result.promptMeta.sourceType, "legacy");
});

test("拒绝未知素材类型", () => {
  assert.throws(
    () => parseVisionPromptResponse(JSON.stringify(createV2Payload({ source_type: "website" }))),
    /模型返回格式不完整，请重新生成/,
  );
});

test("拒绝空 Prompt、错误 schema 和非法 JSON", () => {
  assert.throws(
    () => parseVisionPromptResponse(JSON.stringify(createV2Payload({ image: { final_prompt: "" } }))),
    /模型返回格式不完整，请重新生成/,
  );
  assert.throws(
    () => parseVisionPromptResponse(JSON.stringify(createV2Payload({ schema_version: "3.0" }))),
    /模型返回格式不完整，请重新生成/,
  );
  assert.throws(
    () => parseVisionPromptResponse("not-json"),
    /模型返回格式不完整，请重新生成/,
  );
});
