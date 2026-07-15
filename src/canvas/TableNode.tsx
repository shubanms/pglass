import { KeyRound, Link2, Lock } from 'lucide-react';
import { typeStr } from '../dsl/printer.ts';
import { fkColumnIds } from '../model/schema.ts';
import type { Schema, Table } from '../model/types.ts';
import { HEADER_H, ROW_H, tableSize } from './geometry.ts';

export function TableNode({
  schema,
  table,
  selected,
  lod,
  onPointerDown,
}: {
  schema: Schema;
  table: Table;
  selected: boolean;
  lod: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const { w, h } = tableSize(table);
  const accent = table.color ?? 'var(--accent)';
  const pkSet = new Set(table.primaryKey);
  const fkSet = fkColumnIds(schema, table.id);

  // Level-of-detail: just a coloured rectangle with the name when zoomed out.
  if (lod) {
    return (
      <g transform={`translate(${table.pos.x} ${table.pos.y})`} onPointerDown={onPointerDown}>
        <rect
          width={w}
          height={h}
          rx={6}
          fill="var(--bg-elevated)"
          stroke={selected ? 'var(--accent)' : 'var(--border)'}
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
    <g transform={`translate(${table.pos.x} ${table.pos.y})`} onPointerDown={onPointerDown}>
      <rect
        width={w}
        height={h}
        rx={6}
        fill="var(--bg-elevated)"
        stroke={selected ? 'var(--accent)' : 'var(--border)'}
        strokeWidth={selected ? 2 : 1}
      />
      {/* header accent bar */}
      <rect width={w} height={4} rx={2} fill={accent} />
      {/* header */}
      <foreignObject x={0} y={4} width={w} height={HEADER_H - 4}>
        <div
          className="flex h-full items-center gap-1.5 px-2.5 text-[13px] font-semibold"
          style={{ color: 'var(--text)' }}
        >
          {table.rowLevelSecurity && <Lock size={12} style={{ color: 'var(--text-muted)' }} />}
          <span className="truncate">{table.name}</span>
        </div>
      </foreignObject>
      {!table.collapsed &&
        table.columns.map((col, i) => {
          const y = HEADER_H + i * ROW_H;
          const isPk = pkSet.has(col.id);
          const isFk = fkSet.has(col.id);
          return (
            <foreignObject key={col.id} x={0} y={y} width={w} height={ROW_H}>
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
          );
        })}
    </g>
  );
}
