// The SVG canvas root: pan/zoom, virtualization, LOD, and (Phase 5) editing —
// drag tables, drag-a-port to create an FK, inline rename, context menu, and
// double-click-to-create. See PRD §12.
import { Maximize2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectJunction } from '../model/junction.ts';
import type { ColumnId, RefAction, TableId } from '../model/types.ts';
import { viewDependencies } from '../model/views.ts';
import { useStore } from '../store/index.ts';
import { Edge } from './Edge.tsx';
import { FunctionNode } from './FunctionNode.tsx';
import { GroupLayer } from './GroupLayer.tsx';
import { MNEdge } from './MNEdge.tsx';
import { Minimap } from './Minimap.tsx';
import { StickyNoteNode } from './StickyNoteNode.tsx';
import { TableContextMenu } from './TableContextMenu.tsx';
import { TableNode } from './TableNode.tsx';
import { TriggerChips } from './TriggerChips.tsx';
import { ViewNode } from './ViewNode.tsx';
import { ViewOptions } from './ViewOptions.tsx';
import type { Box } from './geometry.ts';
import {
  columnPortY,
  contentBounds,
  tableBox,
  tablesInRect,
  tablesInView,
  viewBox,
} from './geometry.ts';

const LOD_ZOOM = 0.4;

interface Gesture {
  kind: 'pan' | 'drag' | 'link' | 'marquee';
  startClient: { x: number; y: number };
  startViewport?: { x: number; y: number };
  ids?: TableId[];
  startWorld?: { x: number; y: number };
  fromTable?: TableId;
  fromCol?: ColumnId;
  additive?: boolean;
  baseSelection?: TableId[];
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
  const [marquee, setMarquee] = useState<Box | null>(null);
  const spaceHeld = useRef(false);
  const focusActive = ui.focusMode && selection.tables.size > 0;

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
  // Phase 14: junctions shown as M:N and members of collapsed groups are hidden;
  // a collapsed junction contributes a single dashed edge between its parents.
  const { hidden, mnJunctions, junctionIds } = useMemo(() => {
    const hidden = new Set<TableId>();
    const collapsedGroups = new Set(schema.groups.filter((g) => g.collapsed).map((g) => g.id));
    for (const t of schema.tables) {
      if (t.groupId && collapsedGroups.has(t.groupId)) hidden.add(t.id);
    }
    const mnJunctions = [];
    const junctionIds = new Set<TableId>();
    for (const t of schema.tables) {
      const j = detectJunction(schema, t);
      if (!j) continue;
      junctionIds.add(t.id);
      if (t.showAsMN) {
        hidden.add(t.id);
        mnJunctions.push(j);
      }
    }
    return { hidden, mnJunctions, junctionIds };
  }, [schema]);

  const visibleTables = tablesInView(schema, view).filter((t) => !hidden.has(t.id));
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
      } else if (g.kind === 'marquee' && g.startWorld) {
        const w = toWorld(e.clientX, e.clientY);
        const rect: Box = {
          x: g.startWorld.x,
          y: g.startWorld.y,
          w: w.x - g.startWorld.x,
          h: w.y - g.startWorld.y,
        };
        setMarquee(rect);
        const hits = tablesInRect(schema, rect);
        actions.setSelectedTables(g.additive ? [...(g.baseSelection ?? []), ...hits] : hits);
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
      } else if (g.kind === 'marquee') {
        // a plain click (no drag) on empty space clears the selection
        if (!g.moved && !g.additive) actions.clearSelection();
        setMarquee(null);
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
    const v = useStore.getState().viewport;
    // middle-mouse or held space → pan; plain left-drag → marquee select
    if (e.button === 1 || spaceHeld.current) {
      gesture.current = {
        kind: 'pan',
        startClient: { x: e.clientX, y: e.clientY },
        startViewport: { x: v.x, y: v.y },
      };
      return;
    }
    gesture.current = {
      kind: 'marquee',
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: toWorld(e.clientX, e.clientY),
      additive: e.shiftKey,
      baseSelection: e.shiftKey ? [...useStore.getState().selection.tables] : [],
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

  /** Zoom by a multiplicative factor about the canvas centre. */
  const zoomBy = useCallback(
    (factor: number) => {
      const { x, y, zoom } = useStore.getState().viewport;
      const nz = Math.min(4, Math.max(0.1, zoom * factor));
      const cx = size.w / 2;
      const cy = size.h / 2;
      actions.setViewport({
        zoom: nz,
        x: cx - ((cx - x) / zoom) * nz,
        y: cy - ((cy - y) / zoom) * nz,
      });
    },
    [size, actions],
  );

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

  // keyboard: F fit, 1 100%, Delete removes selection, Space = pan modifier
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.isContentEditable || !!t.closest('.cm-editor') || t.tagName === 'INPUT');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' && !typing(e.target)) {
        spaceHeld.current = true;
        return;
      }
      if (typing(e.target)) return;
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
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceHeld.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
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
          {/* group frames sit behind everything */}
          <GroupLayer />

          {/* sticky notes float below the tables */}
          {schema.notes.map((note) => (
            <StickyNoteNode key={note.id} note={note} zoom={viewport.zoom} />
          ))}

          {/* view → table dependency edges (dashed, best-effort) */}
          <g className="view-deps">
            {schema.views.flatMap((v) => {
              if (!v.pos) return [];
              const vb = viewBox(v);
              const vcx = vb.x + vb.w / 2;
              const vcy = vb.y + vb.h / 2;
              return viewDependencies(schema, v).map((tid) => {
                const t = schema.tables.find((x) => x.id === tid);
                if (!t) return null;
                const tb = tableBox(t);
                const tcx = tb.x + tb.w / 2;
                const tcy = tb.y + tb.h / 2;
                return (
                  <line
                    key={`${v.id}-${tid}`}
                    x1={vcx}
                    y1={vcy}
                    x2={tcx}
                    y2={tcy}
                    stroke={v.color ?? '#7c3aed'}
                    strokeWidth={1}
                    strokeDasharray="3 4"
                    opacity={0.4}
                  />
                );
              });
            })}
          </g>

          <g className="edges" style={{ ['--edge' as string]: 'var(--text-muted)' }}>
            {schema.relationships.map((rel) =>
              // hide an edge when either endpoint is hidden (collapsed group / M:N)
              (visibleIds.has(rel.sourceTable) || visibleIds.has(rel.targetTable)) &&
              !hidden.has(rel.sourceTable) &&
              !hidden.has(rel.targetTable) ? (
                <Edge
                  key={rel.id}
                  schema={schema}
                  rel={rel}
                  style={ui.edgeStyle}
                  compact={ui.compactColumns}
                  dimmed={
                    focusActive &&
                    !selection.tables.has(rel.sourceTable) &&
                    !selection.tables.has(rel.targetTable)
                  }
                />
              ) : null,
            )}
            {/* collapsed-junction M:N edges */}
            {mnJunctions.map((j) => (
              <MNEdge key={j.table.id} schema={schema} junction={j} />
            ))}
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
                compact={ui.compactColumns}
                dimmed={focusActive && !selection.tables.has(table.id)}
                junction={junctionIds.has(table.id)}
                offset={dragOffsetFor(table.id)}
                renaming={renaming === table.id}
                linkable={!!link}
                on={handlers}
              />
            ))}
          </g>

          {/* views + functions (rendered above tables) */}
          <g className="views">
            {schema.views.map((v) => (
              <ViewNode key={v.id} view={v} zoom={viewport.zoom} selected={false} />
            ))}
          </g>
          <g className="functions">
            {schema.routines.map((r) => (
              <FunctionNode key={r.id} routine={r} zoom={viewport.zoom} selected={false} />
            ))}
          </g>

          {/* trigger chips anchored beneath their (visible) table */}
          <g className="triggers">
            {visibleTables.map((table) => (
              <TriggerChips
                key={table.id}
                table={table}
                triggers={schema.triggers.filter((tg) => tg.table === table.id)}
                compact={ui.compactColumns}
                offset={dragOffsetFor(table.id)}
              />
            ))}
          </g>

          {/* marquee selection rectangle */}
          {marquee && (
            <rect
              x={Math.min(marquee.x, marquee.x + marquee.w)}
              y={Math.min(marquee.y, marquee.y + marquee.h)}
              width={Math.abs(marquee.w)}
              height={Math.abs(marquee.h)}
              fill="var(--accent-soft)"
              stroke="var(--accent)"
              strokeWidth={1 / viewport.zoom}
              strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`}
            />
          )}
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

      {ui.showMinimap && <Minimap screenW={size.w} screenH={size.h} />}

      {/* zoom + view controls */}
      <div
        className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border p-1"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--bg-elevated)',
          color: 'var(--text-muted)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <ZoomBtn onClick={() => zoomBy(1 / 1.2)} label="Zoom out">
          <Minus size={15} />
        </ZoomBtn>
        <button
          type="button"
          onClick={() => actions.setViewport({ zoom: 1 })}
          title="Reset zoom (1)"
          className="pgl-hover w-12 rounded-md py-1 text-center text-xs tabular-nums"
          style={{ color: 'var(--text)' }}
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <ZoomBtn onClick={() => zoomBy(1.2)} label="Zoom in">
          <Plus size={15} />
        </ZoomBtn>
        <ZoomBtn onClick={zoomToFit} label="Zoom to fit (F)">
          <Maximize2 size={14} />
        </ZoomBtn>
        <div className="mx-0.5 h-5 w-px" style={{ background: 'var(--border)' }} />
        <ViewOptions />
      </div>
    </div>
  );
}

function ZoomBtn({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="pgl-hover rounded-md p-1.5"
      style={{ color: 'var(--text)' }}
    >
      {children}
    </button>
  );
}
