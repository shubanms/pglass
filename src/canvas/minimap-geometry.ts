// Pure geometry for the minimap (Phase 15). Maps world coordinates into the
// minimap's pixel box (uniform fit with padding) and back, and computes where
// the current viewport rectangle lands inside it. No DOM — unit-testable.
import type { Box } from './geometry.ts';

export interface MinimapTransform {
  /** scale factor world→minimap (uniform) */
  scale: number;
  /** minimap-pixel offset of world origin */
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/** Fit `content` (world bounds) into a `width`×`height` minimap with `pad` px. */
export function minimapTransform(
  content: Box,
  width: number,
  height: number,
  pad = 8,
): MinimapTransform {
  const cw = Math.max(1, content.w);
  const ch = Math.max(1, content.h);
  const scale = Math.min((width - pad * 2) / cw, (height - pad * 2) / ch);
  // centre the content within the minimap box
  const offsetX = pad + (width - pad * 2 - cw * scale) / 2 - content.x * scale;
  const offsetY = pad + (height - pad * 2 - ch * scale) / 2 - content.y * scale;
  return { scale, offsetX, offsetY, width, height };
}

export function worldToMinimap(
  t: MinimapTransform,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: x * t.scale + t.offsetX, y: y * t.scale + t.offsetY };
}

export function minimapToWorld(
  t: MinimapTransform,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: (x - t.offsetX) / t.scale, y: (y - t.offsetY) / t.scale };
}

/**
 * The world rectangle currently visible given a viewport `{x,y,zoom}` and the
 * on-screen canvas size — i.e. what the minimap's viewport indicator covers.
 * Screen (0,0) maps to world (-vx/zoom, -vy/zoom).
 */
export function visibleWorldRect(
  viewport: { x: number; y: number; zoom: number },
  screenW: number,
  screenH: number,
): Box {
  return {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    w: screenW / viewport.zoom,
    h: screenH / viewport.zoom,
  };
}
