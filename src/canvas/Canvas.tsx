// The SVG canvas root: pan/zoom, virtualization, LOD, and (Phase 5) editing —
// drag tables, drag-a-port to create an FK, inline rename, context menu, and
// double-click-to-create. See PRD §12.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnId, RefAction, TableId } from '../model/types.ts';
import { useStore } from '../store/index.ts';
import { Edge } from './Edge.tsx';
import { TableContextMenu } from './TableContextMenu.tsx';
import { TableNode } from './TableNode.tsx';
import type { Box } from './geometry.ts';
import { columnPortY, contentBounds, tableBox, tablesInView } from './geometry.ts';

const LOD_ZOOM = 0.4;

interface Gesture {
  kind: 'pan' | 'drag' | 'link';
  startClient: { x: number; y: number };
  startViewport?: { x: number; y: number };
  ids?: TableId[];
  startWorld?: { x: number; y: number };
  fromTable?: TableId;
  fromCol?: ColumnId;
  moved?: boolean;
}

export function Canvas() {
  const schema = useStore((s) => s.schema);
  const viewport = useStore((s) => s.viewport);
  const selection = useStore((s) => s.selection);
  const ui = useStore((s) => s.ui);
  const stale = useStore((s) => s.stale);
  const actions = useStore((s) => s.actions);

  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const gesture = useRef<Gesture | null>(null);
  const [drag, setDrag] = useState<{ ids: Set<TableId>; dx: number; dy: number } | null>(null);
  const [link, setLink] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
  const [renaming, setRenaming] = useState<TableId | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: TableId } | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: r.width, h: r.height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    const v = useStore.getState().viewport;
    return {
      x: (clientX - (rect?.left ?? 0) - v.x) / v.zoom,
      y: (clientY - (rect?.top ?? 0) - v.y) / v.zoom,
    };
  }, []);

  const snap = useCallback(
    (v: number) => (ui.snapToGrid ? Math.round(v / ui.gridSize) * ui.gridSize : v),
    [ui.snapToGrid, ui.gridSize],
  );

  const view: Box = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    w: size.w / viewport.zoom,
    h: size.h / viewport.zoom,
  };
  const visibleTables = tablesInView(schema, view);
  const visibleIds = new Set(visibleTables.map((t) => t.id));
  const lod = viewport.zoom < LOD_ZOOM;

  // ── global gesture handlers ──
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const dxClient = e.clientX - g.startClient.x;
      const dyClient = e.clientY - g.startClient.y;
      if (Math.abs(dxClient) + Math.abs(dyClient) > 3) g.moved = true;

      if (g.kind === 'pan' && g.startViewport) {
        actions.setViewport({ x: g.startViewport.x + dxClient, y: g.startViewport.y + dyClient });
      } else if (g.kind === 'drag' && g.ids && g.startWorld) {
        const w = toWorld(e.clientX, e.clientY);
        setDrag({ ids: new Set(g.ids), dx: w.x - g.startWorld.x, dy: w.y - g.startWorld.y });
      } else if (g.kind === 'link') {
        const w = toWorld(e.clientX, e.clientY);
        setLink((prev) => (prev ? { ...prev, to: w } : prev));
      }
    };
    const onUp = (e: PointerEvent) => {
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      if (g.kind === 'drag' && g.ids && g.startWorld) {
        if (g.moved) {
          const w = toWorld(e.clientX, e.clientY);
          const rawDx = w.x - g.startWorld.x;
          const rawDy = w.y - g.startWorld.y;
          // snap the final position using the first table as the anchor
          const ids = [...g.ids];
          const first = schema.tables.find((t) => t.id === ids[0]);
          if (first) {
            const targetX = snap(first.pos.x + rawDx);
            const targetY = snap(first.pos.y + rawDy);
            actions.moveTables(ids, targetX - first.pos.x, targetY - first.pos.y);
          }
        }
        setDrag(null);
      } else if (g.kind === 'link' && g.fromTable && g.fromCol) {
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const colEl = el?.closest('[data-drop-col]') as HTMLElement | null;
        const dropTable = colEl?.getAttribute('data-drop-table') as TableId | null;
        const dropCol = colEl?.getAttribute('data-drop-col') as ColumnId | null;
        if (dropTable && dropCol && dropTable !== g.fromTable) {
          createFk(g.fromTable, g.fromCol, dropTable, dropCol);
        }
        setLink(null);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, toWorld, snap, schema]);

  const createFk = useCallback(
    (fromTable: TableId, fromCol: ColumnId, toTable: TableId, toCol: ColumnId) => {
      const src = schema.tables.find((t) => t.id === fromTable);
      const tgt = schema.tables.find((t) => t.id === toTable);
      const sc = src?.columns.find((c) => c.id === fromCol);
      const tc = tgt?.columns.find((c) => c.id === toCol);
      if (!sc || !tc) return;
      const onDelete: RefAction = 'no_action';
      actions.addRelationship({
        sourceTable: fromTable,
        sourceColumns: [fromCol],
        targetTable: toTable,
        targetColumns: [toCol],
        onDelete,
        onUpdate: 'no_action',
      });
      // Type mismatches surface as an L003 lint finding (with the two types).
    },
    [schema, actions],
  );

  // ── pointer entry points ──
  const startTableDrag = useCallback(
    (e: React.PointerEvent, id: TableId) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const additive = e.shiftKey;
      if (!selection.tables.has(id)) actions.selectTable(id, additive);
      const ids =
        selection.tables.has(id) && selection.tables.size > 1 ? [...selection.tables] : [id];
      gesture.current = {
        kind: 'drag',
        startClient: { x: e.clientX, y: e.clientY },
        ids,
        startWorld: toWorld(e.clientX, e.clientY),
      };
    },
    [selection.tables, actions, toWorld],
  );

  const startLink = useCallback(
    (e: React.PointerEvent, id: TableId, col: ColumnId) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const t = schema.tables.find((x) => x.id === id);
      if (!t) return;
      const box = tableBox(t);
      const from = { x: box.x + box.w, y: columnPortY(t, col) };
      gesture.current = {
        kind: 'link',
        startClient: { x: e.clientX, y: e.clientY },
        fromTable: id,
        fromCol: col,
      };
      setLink({ from, to: from });
    },
    [schema.tables],
  );

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    setMenu(null);
    actions.clearSelection();
    const v = useStore.getState().viewport;
    gesture.current = {
      kind: 'pan',
      startClient: { x: e.clientX, y: e.clientY },
      startViewport: { x: v.x, y: v.y },
    };
  };

  const onBackgroundDoubleClick = (e: React.MouseEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    const id = actions.addTable({ pos: { x: snap(w.x), y: snap(w.y) } });
    actions.selectTable(id);
  };

  // ── wheel zoom / pan ──
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const rect = ref.current?.getBoundingClientRect();
        const cx = e.clientX - (rect?.left ?? 0);
        const cy = e.clientY - (rect?.top ?? 0);
        const { x, y, zoom } = useStore.getState().viewport;
        const nz = Math.min(4, Math.max(0.1, zoom * Math.exp(-e.deltaY * 0.0015)));
        actions.setViewport({
          zoom: nz,
          x: cx - ((cx - x) / zoom) * nz,
          y: cy - ((cy - y) / zoom) * nz,
        });
      } else {
        const v = useStore.getState().viewport;
        actions.setViewport({
          x: v.x - (e.shiftKey ? e.deltaY : e.deltaX),
          y: v.y - (e.shiftKey ? 0 : e.deltaY),
        });
      }
    },
    [actions],
  );

  const zoomToFit = useCallback(() => {
    const b = contentBounds(schema);
    const zoom = Math.min(2, Math.min(size.w / b.w, size.h / b.h));
    actions.setViewport({
      zoom,
      x: size.w / 2 - (b.x + b.w / 2) * zoom,
      y: size.h / 2 - (b.y + b.h / 2) * zoom,
    });
  }, [schema, size, actions]);

  const fitNonce = useStore((s) => s.fitNonce);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit only when nonce bumps
  useEffect(() => {
    if (fitNonce > 0 && size.w > 1) zoomToFit();
  }, [fitNonce]);

  // Shift+F focus: fit the viewport to the current selection (or the whole
  // diagram when nothing is selected).
  const focusNonce = useStore((s) => s.focusNonce);
  // biome-ignore lint/correctness/useExhaustiveDependencies: react only to nonce bumps
  useEffect(() => {
    if (focusNonce === 0 || size.w <= 1) return;
    const sel = useStore.getState().selection.tables;
    const targets = sel.size > 0 ? schema.tables.filter((t) => sel.has(t.id)) : schema.tables;
    if (targets.length === 0) return;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const t of targets) {
      const b = tableBox(t);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    const bw = maxX - minX + 120;
    const bh = maxY - minY + 120;
    const zoom = Math.min(1.6, Math.min(size.w / bw, size.h / bh));
    actions.setViewport({
      zoom,
      x: size.w / 2 - (minX + (maxX - minX) / 2) * zoom,
      y: size.h / 2 - (minY + (maxY - minY) / 2) * zoom,
    });
  }, [focusNonce]);

  // Palette "jump to table": pan the requested table to the centre at a
  // comfortable zoom without disrupting the rest of the diagram.
  const reveal = useStore((s) => s.reveal);
  // biome-ignore lint/correctness/useExhaustiveDependencies: react only to nonce bumps
  useEffect(() => {
    if (!reveal || size.w <= 1) return;
    const t = schema.tables.find((x) => x.id === reveal.table);
    if (!t) return;
    const b = tableBox(t);
    const zoom = Math.min(1.2, Math.max(0.6, useStore.getState().viewport.zoom));
    actions.setViewport({
      zoom,
      x: size.w / 2 - (b.x + b.w / 2) * zoom,
      y: size.h / 2 - (b.y + b.h / 2) * zoom,
    });
  }, [reveal?.nonce]);

  // keyboard: F fit, 1 100%, Delete removes selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable ||
          e.target.closest('.cm-editor') ||
          e.target.tagName === 'INPUT')
      )
        return;
      if ((e.key === 'f' || e.key === 'F') && !e.shiftKey) zoomToFit();
      if (e.key === '1') actions.setViewport({ zoom: 1 });
      if (e.key === 'Escape') {
        setMenu(null);
        setRenaming(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.tables.size > 0) {
        actions.deleteTables([...selection.tables]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomToFit, actions, selection.tables]);

  const dragOffsetFor = (id: TableId): { x: number; y: number } | undefined =>
    drag?.ids.has(id) ? { x: drag.dx, y: drag.dy } : undefined;

  const gridPx = ui.gridSize * viewport.zoom;

  const handlers = useMemo(
    () => ({
      onHeaderPointerDown: startTableDrag,
      onPortPointerDown: startLink,
      onHeaderDoubleClick: (id: TableId) => setRenaming(id),
      onContextMenu: (e: React.MouseEvent, id: TableId) => {
        e.preventDefault();
        const rect = ref.current?.getBoundingClientRect();
        setMenu({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0), id });
        if (!selection.tables.has(id)) actions.selectTable(id);
      },
      onRenameCommit: (id: TableId, name: string) => {
        actions.updateTable(id, { name });
        setRenaming(null);
      },
      onRenameCancel: () => setRenaming(null),
    }),
    [selection.tables, startTableDrag, startLink, actions],
  );

  return (
    <div
      ref={ref}
      className="relative min-h-0 flex-1 select-none overflow-hidden"
      style={{
        background: 'var(--canvas-bg)',
        cursor: gesture.current?.kind === 'pan' ? 'grabbing' : 'default',
        // never let a drag (esp. from a column's FK port) start a text
        // selection in the foreignObject rows
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      <svg
        width="100%"
        height="100%"
        onWheel={onWheel}
        onPointerDown={onBackgroundPointerDown}
        onDoubleClick={onBackgroundDoubleClick}
        style={{ opacity: stale ? 0.55 : 1, transition: 'opacity 120ms' }}
      >
        <title>Entity-relationship diagram</title>
        <defs>
          <pattern
            id="grid"
            width={gridPx}
            height={gridPx}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${viewport.x % gridPx} ${viewport.y % gridPx})`}
          >
            <circle cx={0.5} cy={0.5} r={0.5} fill="var(--canvas-grid)" />
          </pattern>
        </defs>
        {ui.showGrid && <rect width="100%" height="100%" fill="url(#grid)" />}

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          <g className="edges" style={{ ['--edge' as string]: 'var(--text-muted)' }}>
            {schema.relationships.map((rel) =>
              visibleIds.has(rel.sourceTable) || visibleIds.has(rel.targetTable) ? (
                <Edge key={rel.id} schema={schema} rel={rel} style={ui.edgeStyle} />
              ) : null,
            )}
          </g>

          {/* ghost link edge while creating an FK */}
          {link && (
            <path
              d={`M ${link.from.x} ${link.from.y} C ${link.from.x + 60} ${link.from.y}, ${link.to.x - 60} ${link.to.y}, ${link.to.x} ${link.to.y}`}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
          )}

          <g className="tables">
            {visibleTables.map((table) => (
              <TableNode
                key={table.id}
                schema={schema}
                table={table}
                selected={selection.tables.has(table.id)}
                lod={lod}
                offset={dragOffsetFor(table.id)}
                renaming={renaming === table.id}
                linkable={!!link}
                on={handlers}
              />
            ))}
          </g>
        </g>
      </svg>

      {menu && (
        <TableContextMenu
          x={menu.x}
          y={menu.y}
          tableId={menu.id}
          onClose={() => setMenu(null)}
          onRename={() => {
            setRenaming(menu.id);
            setMenu(null);
          }}
        />
      )}

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
