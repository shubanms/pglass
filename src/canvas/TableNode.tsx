import { KeyRound, Link2, Lock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { typeStr } from '../dsl/printer.ts';
import { fkColumnIds } from '../model/schema.ts';
import type { ColumnId, Schema, Table, TableId } from '../model/types.ts';
import { HEADER_H, ROW_H, tableSize } from './geometry.ts';

export interface TableHandlers {
  onHeaderPointerDown: (e: React.PointerEvent, id: TableId) => void;
  onPortPointerDown: (e: React.PointerEvent, id: TableId, col: ColumnId) => void;
  onHeaderDoubleClick: (id: TableId) => void;
  onContextMenu: (e: React.MouseEvent, id: TableId) => void;
  onRenameCommit: (id: TableId, name: string) => void;
  onRenameCancel: () => void;
}

export function TableNode({
  schema,
  table,
  selected,
  lod,
  offset,
  renaming,
  linkable,
  on,
}: {
  schema: Schema;
  table: Table;
  selected: boolean;
  lod: boolean;
  /** transient drag offset (not yet committed to the model) */
  offset?: { x: number; y: number };
  renaming: boolean;
  /** true while a link gesture is in progress (show drop affordance) */
  linkable: boolean;
  on: TableHandlers;
}) {
  const { w, h } = tableSize(table);
  const accent = table.color ?? 'var(--accent)';
  const pkSet = new Set(table.primaryKey);
  const fkSet = fkColumnIds(schema, table.id);
  const [hover, setHover] = useState(false);
  const x = table.pos.x + (offset?.x ?? 0);
  const y = table.pos.y + (offset?.y ?? 0);
  const dragging = !!offset && (offset.x !== 0 || offset.y !== 0);

  const outline = selected
    ? 'var(--accent)'
    : linkable && hover
      ? 'var(--accent)'
      : 'var(--border)';

  if (lod) {
    return (
      <g
        transform={`translate(${x} ${y})`}
        onPointerDown={(e) => on.onHeaderPointerDown(e, table.id)}
        onContextMenu={(e) => on.onContextMenu(e, table.id)}
        style={{ cursor: 'grab' }}
      >
        <rect
          width={w}
          height={h}
          rx={6}
          fill="var(--bg-elevated)"
          stroke={outline}
          strokeWidth={selected ? 2 : 1}
        />
        <rect width={w} height={4} rx={2} fill={accent} />
        <text
          x={w / 2}
          y={h / 2}
          textAnchor="middle"
          fontSize={14}
          fontWeight={600}
          fill="var(--text)"
        >
          {table.name}
        </text>
      </g>
    );
  }

  return (
    <g
      className="pgl-table"
      transform={`translate(${x} ${y})`}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onContextMenu={(e) => on.onContextMenu(e, table.id)}
      data-drop-table={table.id}
      style={{
        filter:
          dragging || (hover && !linkable) ? 'drop-shadow(0 6px 16px rgba(0,0,0,0.18))' : 'none',
        transition: dragging ? 'none' : 'filter 120ms ease',
      }}
    >
      <rect
        width={w}
        height={h}
        rx={6}
        fill="var(--bg-elevated)"
        stroke={outline}
        strokeWidth={selected ? 2 : 1}
        style={{ transition: 'stroke 120ms ease' }}
      />
      <rect width={w} height={4} rx={2} fill={accent} />

      {/* header — drag + rename */}
      <foreignObject x={0} y={4} width={w} height={HEADER_H - 4}>
        {renaming ? (
          <RenameInput
            initial={table.name}
            onCommit={(name) => on.onRenameCommit(table.id, name)}
            onCancel={on.onRenameCancel}
          />
        ) : (
          <div
            className="flex h-full items-center gap-1.5 px-2.5 text-[13px] font-semibold"
            style={{ color: 'var(--text)', cursor: 'grab' }}
            onPointerDown={(e) => on.onHeaderPointerDown(e, table.id)}
            onDoubleClick={() => on.onHeaderDoubleClick(table.id)}
            title="Drag to move · double-click to rename"
          >
            {table.rowLevelSecurity && <Lock size={12} style={{ color: 'var(--text-muted)' }} />}
            <span className="truncate">{table.name}</span>
          </div>
        )}
      </foreignObject>

      {!table.collapsed &&
        table.columns.map((col, i) => {
          const rowY = HEADER_H + i * ROW_H;
          const isPk = pkSet.has(col.id);
          const isFk = fkSet.has(col.id);
          return (
            <g key={col.id} data-drop-col={col.id} data-drop-table={table.id}>
              <foreignObject x={0} y={rowY} width={w} height={ROW_H}>
                <div
                  className="flex h-full items-center gap-1.5 px-2.5 text-[12px]"
                  style={{ color: 'var(--text)' }}
                >
                  <span className="flex w-3.5 shrink-0 justify-center">
                    {isPk ? (
                      <KeyRound size={11} style={{ color: '#d97706' }} />
                    ) : isFk ? (
                      <Link2 size={11} style={{ color: 'var(--accent)' }} />
                    ) : null}
                  </span>
                  <span className={`truncate ${col.notNull ? 'font-medium' : ''}`}>{col.name}</span>
                  <span
                    className="ml-auto shrink-0 truncate pl-2 mono text-[11px]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {typeStr(col.type)}
                    {col.check ? ' ✓' : ''}
                  </span>
                </div>
              </foreignObject>
              {/* FK drag port — appears on table hover, right edge */}
              {(hover || linkable) && (
                <circle
                  cx={w}
                  cy={rowY + ROW_H / 2}
                  r={5}
                  fill="var(--accent)"
                  stroke="var(--bg-elevated)"
                  strokeWidth={1.5}
                  style={{
                    cursor: 'crosshair',
                    opacity: hover ? 1 : 0.5,
                    transition: 'opacity 120ms ease',
                  }}
                  onPointerDown={(e) => on.onPortPointerDown(e, table.id, col.id)}
                >
                  <title>Drag to create a foreign key</title>
                </circle>
              )}
            </g>
          );
        })}
    </g>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(value.trim() || initial);
        else if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onBlur={() => onCommit(value.trim() || initial)}
      className="h-full w-full rounded bg-transparent px-2.5 text-[13px] font-semibold outline-none"
      style={{
        color: 'var(--text)',
        boxShadow: 'inset 0 0 0 2px var(--accent)',
        userSelect: 'text',
        WebkitUserSelect: 'text',
      }}
    />
  );
}
