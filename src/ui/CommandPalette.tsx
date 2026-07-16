// Command palette (PRD §15.1) — the primary navigation for a large schema.
// Fuzzy search over every table and enum (jump to it) plus every command.
import { useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyRank } from '../lib/fuzzy.ts';
import { useStore } from '../store/index.ts';

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  group: 'Command' | 'Table' | 'Enum';
  run: () => void;
}

export function CommandPalette({
  onClose,
  commands,
}: {
  onClose: () => void;
  commands: PaletteItem[];
}) {
  const schema = useStore((s) => s.schema);
  const actions = useStore((s) => s.actions);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<PaletteItem[]>(() => {
    const tables: PaletteItem[] = schema.tables.map((t) => ({
      id: `table:${t.id}`,
      label: t.name,
      hint: `${t.columns.length} cols`,
      group: 'Table',
      run: () => actions.revealTable(t.id),
    }));
    const enums: PaletteItem[] = schema.enums.map((e) => ({
      id: `enum:${e.id}`,
      label: e.name,
      hint: `${e.values.length} values`,
      group: 'Enum',
      run: () => {
        /* enums have no canvas node yet — selecting is a no-op jump */
      },
    }));
    return [...commands, ...tables, ...enums];
  }, [schema.tables, schema.enums, commands, actions]);

  const ranked = useMemo(
    () => fuzzyRank(query, items, (it) => it.label).slice(0, 60),
    [query, items],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset cursor on query change
  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const choose = (i: number) => {
    const it = ranked[i]?.item;
    if (!it) return;
    onClose();
    it.run();
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div
      className="pgl-overlay fixed inset-0 z-[60] flex items-start justify-center p-6 pt-[12vh]"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onPointerDown={onClose}
    >
      <div
        className="pgl-dialog flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border shadow-2xl"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, ranked.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(active);
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
          placeholder="Jump to a table or run a command…"
          className="border-b bg-transparent px-4 py-3 text-sm outline-none"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
        />
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto py-1">
          {ranked.length === 0 && (
            <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              No matches
            </div>
          )}
          {ranked.map(({ item }, i) => (
            <button
              key={item.id}
              type="button"
              data-idx={i}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
              className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm"
              style={{
                background: i === active ? 'var(--bg-panel)' : 'transparent',
                color: 'var(--text)',
              }}
            >
              <span
                className="w-14 shrink-0 text-[10px] uppercase tracking-wide"
                style={{ color: 'var(--text-muted)' }}
              >
                {item.group}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && (
                <span className="mono shrink-0 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {item.hint}
                </span>
              )}
            </button>
          ))}
        </div>
        <div
          className="flex shrink-0 items-center gap-3 border-t px-4 py-1.5 text-[11px]"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          <span>↑↓ navigate</span>
          <span>⏎ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
