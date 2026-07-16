import { describe, expect, it } from 'vitest';
import type { Box } from '../geometry.ts';
import {
  minimapToWorld,
  minimapTransform,
  visibleWorldRect,
  worldToMinimap,
} from '../minimap-geometry.ts';

const content: Box = { x: 0, y: 0, w: 1000, h: 500 };

describe('minimapTransform', () => {
  it('fits content inside the minimap box with uniform scale', () => {
    const t = minimapTransform(content, 180, 120, 8);
    // width is the binding dimension: (180-16)/1000 = 0.164 vs (120-16)/500 = 0.208
    expect(t.scale).toBeCloseTo((180 - 16) / 1000, 5);
    // a corner maps inside the box
    const p = worldToMinimap(t, 0, 0);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    const q = worldToMinimap(t, 1000, 500);
    expect(q.x).toBeLessThanOrEqual(180);
    expect(q.y).toBeLessThanOrEqual(120);
  });

  it('round-trips world→minimap→world', () => {
    const t = minimapTransform(content, 200, 140, 10);
    for (const [x, y] of [
      [0, 0],
      [250, 125],
      [1000, 500],
    ] as const) {
      const p = worldToMinimap(t, x, y);
      const w = minimapToWorld(t, p.x, p.y);
      expect(w.x).toBeCloseTo(x, 4);
      expect(w.y).toBeCloseTo(y, 4);
    }
  });
});

describe('visibleWorldRect', () => {
  it('maps the screen viewport to a world rectangle', () => {
    // at zoom 1 with no pan, the visible world rect is exactly the screen box
    const r = visibleWorldRect({ x: 0, y: 0, zoom: 1 }, 800, 600);
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.y).toBeCloseTo(0, 6);
    expect(r.w).toBe(800);
    expect(r.h).toBe(600);
  });

  it('accounts for pan and zoom', () => {
    // panned so world (100,50) is at screen origin, zoomed 2x
    const r = visibleWorldRect({ x: -200, y: -100, zoom: 2 }, 800, 600);
    expect(r.x).toBe(100);
    expect(r.y).toBe(50);
    expect(r.w).toBe(400);
    expect(r.h).toBe(300);
  });
});
