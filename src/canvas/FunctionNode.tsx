// A stored function/procedure rendered on the canvas (Phase 17). A distinct
// dashed node with a body preview and an FN tag; draggable, recolourable,
// deletable. The signature and body are edited through the DSL text.
import { FunctionSquare, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Routine } from '../model/types.ts';
import { useStore } from '../store/index.ts';
import { HEADER_H, routineSize } from './geometry.ts';

const ROUTINE_MAX_LINES = 6;

export function FunctionNode({
  routine,
  zoom,
  selected,
}: { routine: Routine; zoom: number; selected: boolean }) {
  const actions = useStore((s) => s.actions);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const { w, h } = routineSize(routine);
  const accent = routine.color ?? '#0d9488';
  const px = (routine.pos?.x ?? 0) + offset.x;
  const py = (routine.pos?.y ?? 0) + offset.y;

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    actions.setSelectedTables([]); // functions aren't tables; clear table selection
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
        if (dx !== 0 || dy !== 0) actions.moveRoutine(routine.id, dx, dy);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const bodyLines = routine.body.split('\n').slice(0, ROUTINE_MAX_LINES);

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
        strokeDasharray="2 3"
      />
      <rect width={w} height={4} rx={2} fill={accent} />

      <foreignObject x={0} y={4} width={w} height={HEADER_H - 4}>
        <div
          className="flex h-full items-center gap-1.5 px-2.5 text-[13px] font-semibold"
          style={{ color: 'var(--text)', cursor: 'grab' }}
          onPointerDown={onHeaderPointerDown}
          title="Drag to move · edit the function in the editor"
        >
          <FunctionSquare size={12} style={{ color: accent }} />
          <span className="truncate">{routine.name}</span>
          {routine.returns && (
            <span className="mono shrink-0 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              → {routine.returns}
            </span>
          )}
          <span
            className="ml-auto shrink-0 rounded px-1 text-[9px] font-bold uppercase"
            style={{ background: 'var(--accent-soft)', color: accent }}
          >
            {routine.language}
          </span>
        </div>
      </foreignObject>

      <foreignObject x={0} y={HEADER_H} width={w} height={h - HEADER_H}>
        <div
          className="mono h-full overflow-hidden px-2.5 py-1 text-[10px] leading-[14px]"
          style={{ color: 'var(--text-muted)', whiteSpace: 'pre' }}
        >
          {bodyLines.join('\n')}
        </div>
      </foreignObject>

      {hover && (
        <foreignObject x={w - 44} y={-2} width={42} height={18}>
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              aria-label="Delete function"
              onClick={() => actions.deleteRoutine(routine.id)}
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
