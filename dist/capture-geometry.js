export function resolveCropRect(bitmapWidth, bitmapHeight, selection = {}) {
  const safeBitmapWidth = Math.max(1, Math.floor(Number(bitmapWidth) || 1));
  const safeBitmapHeight = Math.max(1, Math.floor(Number(bitmapHeight) || 1));
  const fallbackScale = positiveNumber(selection.devicePixelRatio) || 1;
  const viewportWidth = positiveNumber(selection.viewportWidth);
  const viewportHeight = positiveNumber(selection.viewportHeight);
  const scaleX = viewportWidth ? safeBitmapWidth / viewportWidth : fallbackScale;
  const scaleY = viewportHeight ? safeBitmapHeight / viewportHeight : fallbackScale;

  const left = Math.max(0, finiteNumber(selection.x));
  const top = Math.max(0, finiteNumber(selection.y));
  const right = left + Math.max(1, positiveNumber(selection.width) || 1);
  const bottom = top + Math.max(1, positiveNumber(selection.height) || 1);

  // Start edges round inward and end edges round inward as well. This keeps the
  // exported bitmap strictly inside the user's CSS-pixel selection, so pixels
  // from the surrounding page cannot leak into the right or bottom preview.
  const sx = clamp(Math.ceil(left * scaleX), 0, safeBitmapWidth - 1);
  const sy = clamp(Math.ceil(top * scaleY), 0, safeBitmapHeight - 1);
  const ex = clamp(Math.floor(right * scaleX), sx + 1, safeBitmapWidth);
  const ey = clamp(Math.floor(bottom * scaleY), sy + 1, safeBitmapHeight);

  return { sx, sy, sw: ex - sx, sh: ey - sy };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}
