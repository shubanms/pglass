// The SVG canvas root: a single <svg> with a <g> transform for pan/zoom, plus
// virtualization and level-of-detail. See PRD §12.1.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store/index.ts';
import { Edge } from './Edge.tsx';
import { TableNode } from './TableNode.tsx';
import type { Box } from './geometry.ts';
import { contentBounds, tablesInView } from './geometry.ts';

const LOD_ZOOM = 0.4;

export function Canvas() {
  const schema = useStore((s) => s.schema);
  const viewport = useStore((s) => s.viewport);
  const selection = useStore((s) => s.selection);
  const ui = useStore((s) => s.ui);
  const stale = useStore((s) => s.stale);
  const actions = useStore((s) => s.actions);

  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: r.width, h: r.height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  // world-space rect currently visible
  const view: Box = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    w: size.w / viewport.zoom,
    h: size.h / viewport.zoom,
  };

  const visibleTables = tablesInView(schema, view);
  const visibleIds = new Set(visibleTables.map((t) => t.id));
  const lod = viewport.zoom < LOD_ZOOM;

  // ── pan / zoom ──
  const panning = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // zoom to cursor
        const rect = ref.current?.getBoundingClientRect();
        const cx = e.clientX - (rect?.left ?? 0);
        const cy = e.clientY - (rect?.top ?? 0);
        const { x, y, zoom } = useStore.getState().viewport;
        const factor = Math.exp(-e.deltaY * 0.0015);
        const nz = Math.min(4, Math.max(0.1, zoom * factor));
        // keep the world point under the cursor fixed
        const wx = (cx - x) / zoom;
        const wy = (cy - y) / zoom;
        actions.setViewport({ zoom: nz, x: cx - wx * nz, y: cy - wy * nz });
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        const v = useStore.getState().viewport;
        actions.setViewport({ x: v.x - dx, y: v.y - dy });
      }
    },
    [actions],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 1 || e.button === 0) {
        const v = useStore.getState().viewport;
        panning.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y };
        (e.target as Element).setPointerCapture?.(e.pointerId);
        actions.clearSelection();
      }
    },
    [actions],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!panning.current) return;
      const dx = e.clientX - panning.current.x;
      const dy = e.clientY - panning.current.y;
      actions.setViewport({ x: panning.current.vx + dx, y: panning.current.vy + dy });
    },
    [actions],
  );
  const onPointerUp = useCallback(() => {
    panning.current = null;
  }, []);

  const zoomToFit = useCallback(() => {
    const b = contentBounds(schema);
    const zoom = Math.min(2, Math.min(size.w / b.w, size.h / b.h));
    actions.setViewport({
      zoom,
      x: size.w / 2 - (b.x + b.w / 2) * zoom,
      y: size.h / 2 - (b.y + b.h / 2) * zoom,
    });
  }, [schema, size, actions]);

  // zoom-to-fit whenever the store requests it (after layout / schema load)
  const fitNonce = useStore((s) => s.fitNonce);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit only when nonce bumps
  useEffect(() => {
    if (fitNonce > 0 && size.w > 1) zoomToFit();
  }, [fitNonce]);

  // keyboard: F = fit, 1 = 100%
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || e.target.closest('.cm-editor'))
      )
        return;
      if (e.key === 'f' || e.key === 'F') zoomToFit();
      if (e.key === '1') actions.setViewport({ zoom: 1 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomToFit, actions]);

  return (
    <div
      ref={ref}
      className="relative min-h-0 flex-1 overflow-hidden"
      style={{ background: 'var(--canvas-bg)', cursor: panning.current ? 'grabbing' : 'default' }}
    >
      <svg
        width="100%"
        height="100%"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ opacity: stale ? 0.55 : 1, transition: 'opacity 120ms' }}
      >
        <title>Entity-relationship diagram</title>
        <defs>
          <pattern
            id="grid"
            width={ui.gridSize * viewport.zoom}
            height={ui.gridSize * viewport.zoom}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${viewport.x % (ui.gridSize * viewport.zoom)} ${viewport.y % (ui.gridSize * viewport.zoom)})`}
          >
            <circle cx={0.5} cy={0.5} r={0.5} fill="var(--canvas-grid)" />
          </pattern>
        </defs>
        {ui.showGrid && <rect width="100%" height="100%" fill="url(#grid)" />}

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {/* edges (rendered if either endpoint table is visible) */}
          <g className="edges" style={{ ['--edge' as string]: 'var(--text-muted)' }}>
            {schema.relationships.map((rel) =>
              visibleIds.has(rel.sourceTable) || visibleIds.has(rel.targetTable) ? (
                <Edge key={rel.id} schema={schema} rel={rel} style={ui.edgeStyle} />
              ) : null,
            )}
          </g>

          {/* tables */}
          <g className="tables">
            {visibleTables.map((table) => (
              <TableNode
                key={table.id}
                schema={schema}
                table={table}
                selected={selection.tables.has(table.id)}
                lod={lod}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  actions.selectTable(table.id, e.shiftKey);
                }}
              />
            ))}
          </g>
        </g>
      </svg>

      {/* zoom controls */}
      <div
        className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--bg-elevated)',
          color: 'var(--text-muted)',
        }}
      >
        <button type="button" onClick={zoomToFit} className="hover:opacity-80">
          Fit
        </button>
        <span>·</span>
        <span>{Math.round(viewport.zoom * 100)}%</span>
      </div>
    </div>
  );
}
