// Table groups on the canvas (Phase 14). Each group draws a soft tinted frame
// around its member tables with a label chip (rename, collapse, ungroup). A
// collapsed group hides its members behind a single chip.
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { GroupId } from '../model/types.ts';
import { useStore } from '../store/index.ts';
import { tableBox } from './geometry.ts';

const PAD = 22;
const LABEL_H = 22;

export function GroupLayer() {
  const schema = useStore((s) => s.schema);
  const actions = useStore((s) => s.actions);
  const [renaming, setRenaming] = useState<GroupId | null>(null);

  return (
    <g className="groups">
      {schema.groups.map((g) => {
        const members = schema.tables.filter((t) => t.groupId === g.id);
        if (members.length === 0) return null;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const t of members) {
          const b = tableBox(t);
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.w);
          maxY = Math.max(maxY, b.y + b.h);
        }
        const x = minX - PAD;
        const y = minY - PAD - LABEL_H;
        const w = maxX - minX + PAD * 2;
        const color = g.color;

        if (g.collapsed) {
          return (
            <g key={g.id} transform={`translate(${x} ${y})`}>
              <rect
                width={Math.max(160, g.name.length * 8 + 90)}
                height={LABEL_H + 14}
                rx={8}
                fill="var(--bg-elevated)"
                stroke={color}
                strokeWidth={1.5}
              />
              <rect width={6} height={LABEL_H + 14} rx={3} fill={color} />
              <foreignObject
                x={10}
                y={0}
                width={Math.max(150, g.name.length * 8 + 80)}
                height={LABEL_H + 14}
              >
                <div
                  className="flex h-full items-center gap-1.5 text-[12px]"
                  style={{ color: 'var(--text)' }}
                >
                  <button
                    type="button"
                    onClick={() => actions.toggleGroupCollapsed(g.id)}
                    className="pgl-hover rounded p-0.5"
                    title="Expand group"
                  >
                    <ChevronRight size={13} />
                  </button>
                  <span className="font-semibold">{g.name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>· {members.length} tables</span>
                </div>
              </foreignObject>
            </g>
          );
        }

        const h = maxY - minY + PAD * 2 + LABEL_H;
        return (
          <g key={g.id}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={12}
              fill={color}
              fillOpacity={0.05}
              stroke={color}
              strokeOpacity={0.5}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            <foreignObject x={x + 8} y={y + 2} width={w - 16} height={LABEL_H}>
              <div className="flex h-full items-center gap-1 text-[12px]">
                <button
                  type="button"
                  onClick={() => actions.toggleGroupCollapsed(g.id)}
                  className="pgl-hover rounded p-0.5"
                  style={{ color }}
                  title="Collapse group"
                >
                  <ChevronDown size={13} />
                </button>
                {renaming === g.id ? (
                  <GroupNameInput
                    initial={g.name}
                    onCommit={(name) => {
                      actions.updateGroup(g.id, { name: name || g.name });
                      setRenaming(null);
                    }}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <button
                    type="button"
                    onDoubleClick={() => setRenaming(g.id)}
                    className="font-semibold"
                    style={{ color }}
                    title="Double-click to rename"
                  >
                    {g.name}
                  </button>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => actions.ungroup(g.id)}
                  className="pgl-hover rounded p-0.5"
                  style={{ color: 'var(--text-muted)' }}
                  title="Ungroup"
                >
                  <X size={12} />
                </button>
              </div>
            </foreignObject>
          </g>
        );
      })}
    </g>
  );
}

function GroupNameInput({
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
        if (e.key === 'Enter') onCommit(value.trim());
        else if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onBlur={() => onCommit(value.trim())}
      className="rounded bg-transparent px-1 text-[12px] font-semibold outline-none"
      style={{ color: 'var(--text)', boxShadow: 'inset 0 0 0 1.5px var(--accent)', width: '10rem' }}
    />
  );
}
