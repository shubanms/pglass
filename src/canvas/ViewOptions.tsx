// Canvas "view options" popover (Phase 15) — surfaces the view flags that
// previously had no UI: edge style, grid, snap, minimap, compact columns, focus.
import { Check, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { EdgeStyle } from '../store/index.ts';
import { useStore } from '../store/index.ts';

const EDGE_STYLES: EdgeStyle[] = ['orthogonal', 'bezier', 'straight'];

export function ViewOptions() {
  const ui = useStore((s) => s.ui);
  const actions = useStore((s) => s.actions);
  const [open, setOpen] = useState(false);

  const Toggle = ({
    label,
    on,
    onClick,
  }: {
    label: string;
    on: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="pgl-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]"
      style={{ color: 'var(--text)' }}
    >
      <span className="flex w-4 justify-center" style={{ color: 'var(--accent)' }}>
        {on && <Check size={14} />}
      </span>
      {label}
    </button>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="View options"
        title="View options"
        className="pgl-hover rounded-md p-1.5"
        style={{ color: open ? 'var(--text)' : 'var(--text-muted)' }}
      >
        <SlidersHorizontal size={15} />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close view options"
            onClick={() => setOpen(false)}
          />
          <div
            className="pgl-menu absolute bottom-full right-0 z-50 mb-2 w-52 rounded-lg border p-1"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg-elevated)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <div
              className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              Edges
            </div>
            <div className="flex gap-1 px-1 pb-1">
              {EDGE_STYLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => actions.setUi('edgeStyle', s)}
                  className="flex-1 rounded-md border px-1 py-1 text-[11px] capitalize"
                  style={{
                    borderColor: 'var(--border)',
                    background: ui.edgeStyle === s ? 'var(--accent-soft)' : 'transparent',
                    color: ui.edgeStyle === s ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
            <Toggle label="Grid" on={ui.showGrid} onClick={() => actions.toggleUi('showGrid')} />
            <Toggle
              label="Snap to grid"
              on={ui.snapToGrid}
              onClick={() => actions.toggleUi('snapToGrid')}
            />
            <Toggle
              label="Minimap"
              on={ui.showMinimap}
              onClick={() => actions.toggleUi('showMinimap')}
            />
            <Toggle
              label="Compact columns"
              on={ui.compactColumns}
              onClick={() => actions.toggleUi('compactColumns')}
            />
            <Toggle
              label="Focus mode"
              on={ui.focusMode}
              onClick={() => actions.toggleUi('focusMode')}
            />
          </div>
        </>
      )}
    </div>
  );
}
