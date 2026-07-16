// Minimap overview (Phase 15). A scaled bird's-eye of the whole diagram with a
// viewport indicator; click or drag inside it to recenter the canvas.
import { useCallback, useRef } from 'react';
import { useStore } from '../store/index.ts';
import { contentBounds, tableBox } from './geometry.ts';
import {
  minimapToWorld,
  minimapTransform,
  visibleWorldRect,
  worldToMinimap,
} from './minimap-geometry.ts';

const W = 180;
const H = 120;

export function Minimap({ screenW, screenH }: { screenW: number; screenH: number }) {
  const schema = useStore((s) => s.schema);
  const viewport = useStore((s) => s.viewport);
  const setViewport = useStore((s) => s.actions.setViewport);
  const svgRef = useRef<SVGSVGElement>(null);

  const bounds = contentBounds(schema, 80);
  const t = minimapTransform(bounds, W, H, 8);
  const vis = visibleWorldRect(viewport, screenW, screenH);
  const vr = {
    tl: worldToMinimap(t, vis.x, vis.y),
    br: worldToMinimap(t, vis.x + vis.w, vis.y + vis.h),
  };

  // Recenter the canvas so the clicked world point is centred on screen.
  const centerOn = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const w = minimapToWorld(t, clientX - rect.left, clientY - rect.top);
      const z = useStore.getState().viewport.zoom;
      setViewport({ x: screenW / 2 - w.x * z, y: screenH / 2 - w.y * z });
    },
    [t, screenW, screenH, setViewport],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    centerOn(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => centerOn(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (schema.tables.length === 0) return null;

  return (
    <svg
      ref={svgRef}
      width={W}
      height={H}
      onPointerDown={onPointerDown}
      className="absolute bottom-16 right-3 cursor-pointer rounded-lg border"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--bg-elevated)',
        boxShadow: 'var(--shadow-sm)',
      }}
      aria-label="Minimap"
    >
      <title>Minimap — click to navigate</title>
      {schema.tables.map((table) => {
        const b = tableBox(table);
        const p = worldToMinimap(t, b.x, b.y);
        return (
          <rect
            key={table.id}
            x={p.x}
            y={p.y}
            width={Math.max(2, b.w * t.scale)}
            height={Math.max(2, b.h * t.scale)}
            rx={1.5}
            fill={table.color ?? 'var(--accent)'}
            opacity={0.55}
          />
        );
      })}
      <rect
        x={vr.tl.x}
        y={vr.tl.y}
        width={Math.max(4, vr.br.x - vr.tl.x)}
        height={Math.max(4, vr.br.y - vr.tl.y)}
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth={1.5}
        rx={2}
      />
    </svg>
  );
}
