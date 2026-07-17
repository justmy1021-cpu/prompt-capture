import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const backgroundSource = await readFile(new URL("../public/background.js", import.meta.url), "utf8");
const contentSource = await readFile(new URL("../public/content-script.js", import.meta.url), "utf8");

const routedMessages = [
  "toggle-toolbar",
  "show-toolbar",
  "start-shortcut",
  "capture-selection",
  "capture-and-generate",
  "generate-from-capture",
];

test("后台与内容脚本使用同一组升级消息通道", () => {
  for (const name of routedMessages) {
    const channel = `prompt-capture/${name}-v7`;
    assert.match(backgroundSource, new RegExp(channel));
    assert.match(contentSource, new RegExp(channel));
  }
  assert.doesNotMatch(backgroundSource, /prompt-capture\/.+-v5/);
  assert.doesNotMatch(contentSource, /prompt-capture\/.+-v5/);
});

test("内容脚本版本随消息通道升级，允许替换已打开页面的旧实例", () => {
  assert.match(contentSource, /const VERSION = "2026-07-17-capture-geometry-v15"/);
  assert.match(backgroundSource, /tabs that predate an update/);
  assert.match(backgroundSource, /chrome\.scripting\.executeScript/);
});

test("截图前等待两帧重绘，避免选区边框残留在预览中", () => {
  assert.match(contentSource, /requestAnimationFrame\(\(\) => window\.requestAnimationFrame\(resolve\)\)/);
  assert.match(contentSource, /await waitForCapturePaint\(\)/);
});

test("选区边框使用 border-box 与目标图片保持同宽同高", () => {
  for (const selector of ["pc-selection-box", "pc-image-outline", "pc-page-outline"]) {
    assert.match(contentSource, new RegExp(`\\.${selector} \\{[\\s\\S]*?box-sizing: border-box !important;`));
  }
});
