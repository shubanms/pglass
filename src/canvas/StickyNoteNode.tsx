// Sticky notes on the canvas (Phase 14). A draggable, editable annotation card.
// Text is plain (whitespace-preserving); the DSL already round-trips notes.
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StickyNote } from '../model/types.ts';
import { useStore } from '../store/index.ts';

const SWATCHES = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#e9d5ff', '#fed7aa'];

export function StickyNoteNode({ note, zoom }: { note: StickyNote; zoom: number }) {
  const actions = useStore((s) => s.actions);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [editing, setEditing] = useState(false);
  const [hover, setHover] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const x = note.pos.x + offset.x;
  const y = note.pos.y + offset.y;

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editing) return;
    e.stopPropagation();
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
        if (dx !== 0 || dy !== 0) actions.moveNote(note.id, dx, dy);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <g
      transform={`translate(${x} ${y})`}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <rect
        width={note.size.w}
        height={note.size.h}
        rx={6}
        fill={note.color}
        stroke="rgba(0,0,0,0.12)"
        strokeWidth={1}
        style={{ filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.15))' }}
      />
      {/* drag handle strip */}
      <rect
        width={note.size.w}
        height={16}
        rx={6}
        fill="rgba(0,0,0,0.06)"
        style={{ cursor: 'grab' }}
        onPointerDown={onHeaderPointerDown}
      />
      <foreignObject x={0} y={16} width={note.size.w} height={note.size.h - 16}>
        {editing ? (
          <NoteEditor
            initial={note.text}
            onCommit={(text) => {
              actions.updateNote(note.id, { text });
              setEditing(false);
            }}
          />
        ) : (
          <div
            className="h-full w-full overflow-auto whitespace-pre-wrap p-2 text-[12px] leading-snug"
            style={{ color: '#3a3223', cursor: 'text' }}
            onDoubleClick={() => setEditing(true)}
            title="Double-click to edit"
          >
            {note.text || 'Double-click to edit'}
          </div>
        )}
      </foreignObject>

      {hover && !editing && (
        <foreignObject x={note.size.w - 74} y={-2} width={72} height={18}>
          <div className="flex items-center justify-end gap-1">
            {SWATCHES.slice(0, 3).map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                onClick={() => actions.updateNote(note.id, { color: c })}
                className="h-3 w-3 rounded-full ring-1 ring-black/20"
                style={{ background: c }}
              />
            ))}
            <button
              type="button"
              aria-label="Delete note"
              onClick={() => actions.deleteNote(note.id)}
              style={{ color: '#7c2d12' }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

function NoteEditor({ initial, onCommit }: { initial: string; onCommit: (text: string) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) onCommit(value);
        e.stopPropagation();
      }}
      onBlur={() => onCommit(value)}
      className="h-full w-full resize-none bg-transparent p-2 text-[12px] leading-snug outline-none"
      style={{ color: '#3a3223' }}
    />
  );
}
