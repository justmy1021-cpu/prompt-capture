import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

test("嵌入插件高度受当前视口约束", () => {
  assert.match(styles, /\.preview-stage\.embedded-stage\s*\{[\s\S]*?height:\s*100dvh;/);
  assert.match(styles, /\.embedded-stage \.toolbar\s*\{[\s\S]*?height:\s*min\(var\(--toolbar-height\),\s*100dvh\);/);
});

test("结果、历史和设置状态在小屏内可收缩", () => {
  assert.match(
    styles,
    /\.embedded-stage \.result-state,[\s\S]*?\.embedded-stage \.settings-state\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*0;[\s\S]*?flex:\s*1 1 auto;/,
  );
  assert.match(styles, /\.settings-state\s*\{[\s\S]*?overflow:\s*auto;/);
  assert.match(styles, /\.history-list\s*\{[\s\S]*?overflow:\s*auto;/);
});

test("矮视口会压缩结果预览图，为底部操作栏保留空间", () => {
  assert.match(
    styles,
    /@media \(max-height:\s*784px\)[\s\S]*?\.embedded-stage \.result-image[\s\S]*?max-height:\s*clamp\(88px,\s*32dvh,\s*280px\);/,
  );
});

test("设置页内容底部显示弱化版本号", () => {
  assert.match(app, /<section className="settings-group settings-group--last">[\s\S]*?<p className="settings-version">v0\.2\.5<\/p>/);
  assert.match(styles, /\.settings-version\s*\{[\s\S]*?margin:\s*28px 0 4px;[\s\S]*?font-size:\s*12px;[\s\S]*?text-align:\s*center;/);
  assert.doesNotMatch(styles, /\.settings-version\s*\{[^}]*position:\s*(fixed|sticky);/);
});
