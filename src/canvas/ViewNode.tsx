// A (materialized) view rendered on the canvas (Phase 16). A distinct
// dashed-header node with a query preview; draggable, recolourable, deletable.
// The query itself is edited through the DSL text (it round-trips).
import { Eye, Layers, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { View } from '../model/types.ts';
import { useStore } from '../store/index.ts';
import { HEADER_H, viewSize } from './geometry.ts';

const VIEW_MAX_LINES = 6;

export function ViewNode({
  view,
  zoom,
  selected,
}: { view: View; zoom: number; selected: boolean }) {
  const actions = useStore((s) => s.actions);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const { w, h } = viewSize(view);
  const accent = view.color ?? '#7c3aed';
  const px = (view.pos?.x ?? 0) + offset.x;
  const py = (view.pos?.y ?? 0) + offset.y;

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    actions.setSelectedTables([]); // views aren't tables; clear table selection
    drag.current = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      setOffset({
        x: (ev.clientX - drag.current.x) / zoom,
        y: (ev.clientY - drag.current.y) / zoom,
      });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (drag.current) {
        const dx = (ev.clientX - drag.current.x) / zoom;
        const dy = (ev.clientY - drag.current.y) / zoom;
        drag.current = null;
        setOffset({ x: 0, y: 0 });
        if (dx !== 0 || dy !== 0) actions.moveView(view.id, dx, dy);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const queryLines = view.query.split('\n').slice(0, VIEW_MAX_LINES);

  return (
    <g
      transform={`translate(${px} ${py})`}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{ filter: hover ? 'drop-shadow(0 6px 16px rgba(0,0,0,0.18))' : 'none' }}
    >
      <rect
        width={w}
        height={h}
        rx={8}
        fill="var(--bg-elevated)"
        stroke={selected ? 'var(--accent)' : accent}
        strokeWidth={selected ? 2 : 1}
        strokeDasharray="5 3"
      />
      <rect width={w} height={4} rx={2} fill={accent} />

      <foreignObject x={0} y={4} width={w} height={HEADER_H - 4}>
        <div
          className="flex h-full items-center gap-1.5 px-2.5 text-[13px] font-semibold"
          style={{ color: 'var(--text)', cursor: 'grab' }}
          onPointerDown={onHeaderPointerDown}
          title="Drag to move · edit the query in the editor"
        >
          {view.materialized ? (
            <Layers size={12} style={{ color: accent }} />
          ) : (
            <Eye size={12} style={{ color: accent }} />
          )}
          <span className="truncate">{view.name}</span>
          <span
            className="ml-auto shrink-0 rounded px-1 text-[9px] font-bold uppercase"
            style={{ background: 'var(--accent-soft)', color: accent }}
          >
            {view.materialized ? 'MAT' : 'VIEW'}
          </span>
        </div>
      </foreignObject>

      <foreignObject x={0} y={HEADER_H} width={w} height={h - HEADER_H}>
        <div
          className="mono h-full overflow-hidden px-2.5 py-1 text-[10px] leading-[14px]"
          style={{ color: 'var(--text-muted)', whiteSpace: 'pre' }}
        >
          {queryLines.join('\n')}
        </div>
      </foreignObject>

      {hover && (
        <foreignObject x={w - 44} y={-2} width={42} height={18}>
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              aria-label="Delete view"
              onClick={() => actions.deleteView(view.id)}
              style={{ color: '#dc2626' }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </foreignObject>
      )}
    </g>
  );
}
