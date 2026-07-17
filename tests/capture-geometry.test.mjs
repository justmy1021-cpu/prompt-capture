import test from "node:test";
import assert from "node:assert/strict";
import { resolveCropRect } from "../public/capture-geometry.js";

test("按截图实际尺寸换算缩放比例，并将四边收在选区内部", () => {
  assert.deepEqual(
    resolveCropRect(1920, 1080, {
      x: 100.2,
      y: 50.2,
      width: 300.4,
      height: 200.4,
      viewportWidth: 1745.45,
      viewportHeight: 981.82,
      devicePixelRatio: 1.1,
    }),
    { sx: 111, sy: 56, sw: 329, sh: 219 },
  );
});

test("旧数据缺少视口尺寸时回退到 devicePixelRatio", () => {
  assert.deepEqual(
    resolveCropRect(1000, 800, {
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      devicePixelRatio: 2,
    }),
    { sx: 20, sy: 40, sw: 200, sh: 120 },
  );
});

test("靠近截图边缘的选区不会越界", () => {
  assert.deepEqual(
    resolveCropRect(500, 300, {
      x: 490,
      y: 295,
      width: 40,
      height: 30,
      viewportWidth: 500,
      viewportHeight: 300,
    }),
    { sx: 490, sy: 295, sw: 10, sh: 5 },
  );
});
