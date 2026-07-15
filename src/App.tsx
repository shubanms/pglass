import {
  Columns2,
  Database,
  FileDown,
  FileUp,
  GitCompare,
  LayoutGrid,
  Moon,
  Sun,
} from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { Canvas } from './canvas/Canvas.tsx';
import { parse } from './dsl/parser.ts';
import type { Table, TableId } from './model/types.ts';
import { useStore } from './store/index.ts';
import { EditorPane } from './ui/EditorPane.tsx';
import { ExportDialog } from './ui/ExportDialog.tsx';
import { ImportDialog } from './ui/ImportDialog.tsx';

type DialogKind = 'import' | 'export' | null;
const DialogCtx = createContext<(d: DialogKind) => void>(() => {});

function useAppliedTheme() {
  const theme = useStore((s) => s.ui.theme);
  useEffect(() => {
    const resolve = () =>
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme;
    document.documentElement.dataset.theme = resolve();
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        document.documentElement.dataset.theme = resolve();
      };
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
  }, [theme]);
}

export function App() {
  useAppliedTheme();
  const ui = useStore((s) => s.ui);
  const hasTables = useStore((s) => s.schema.tables.length > 0);
  const [dialog, setDialog] = useState<DialogKind>(null);

  return (
    <DialogCtx.Provider value={setDialog}>
      <div className="flex h-full flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          {ui.leftPanel && <LeftPanel />}
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              {ui.editorPane !== 'hidden' && ui.editorPane !== 'full' && hasTables && (
                <div
                  className="w-[42%] min-w-[280px] max-w-[560px] border-r"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <EditorPane />
                </div>
              )}
              {ui.editorPane === 'full' ? (
                <div className="min-h-0 flex-1">
                  <EditorPane />
                </div>
              ) : hasTables ? (
                <Canvas />
              ) : (
                <EmptyState />
              )}
            </div>
            <BottomPanel />
          </main>
          {ui.rightPanel && <RightPanel />}
        </div>
      </div>
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
    </DialogCtx.Provider>
  );
}

function TopBar() {
  const theme = useStore((s) => s.ui.theme);
  const actions = useStore((s) => s.actions);
  const editorPane = useStore((s) => s.ui.editorPane);
  const setDialog = useContext(DialogCtx);
  const hasTables = useStore((s) => s.schema.tables.length > 0);
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <header
      className="flex h-11 shrink-0 items-center gap-3 border-b px-3"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
    >
      <div className="flex items-center gap-2 font-semibold">
        <Database size={18} style={{ color: 'var(--accent)' }} />
        <span>Pglass</span>
      </div>
      <div className="flex-1" />
      <ToolbarButton
        icon={<FileUp size={15} />}
        label="Import"
        onClick={() => setDialog('import')}
      />
      <ToolbarButton
        icon={<FileDown size={15} />}
        label="Export"
        onClick={() => hasTables && setDialog('export')}
        disabled={!hasTables}
      />
      <ToolbarButton icon={<GitCompare size={15} />} label="Diff" disabled />
      <ToolbarButton icon={<LayoutGrid size={15} />} label="Layout" disabled />
      <button
        type="button"
        onClick={() => actions.setUi('editorPane', editorPane === 'hidden' ? 'split' : 'hidden')}
        className="ml-1 rounded p-1.5 hover:opacity-80"
        style={{ color: 'var(--text-muted)' }}
        aria-label="Toggle editor"
        title="Toggle editor (Cmd+\\)"
      >
        <Columns2 size={16} />
      </button>
      <button
        type="button"
        onClick={() => actions.setUi('theme', dark ? 'light' : 'dark')}
        className="rounded p-1.5 hover:opacity-80"
        style={{ color: 'var(--text-muted)' }}
        aria-label="Toggle theme"
      >
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </header>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm hover:opacity-80 disabled:opacity-40"
      style={{ color: 'var(--text)' }}
    >
      {icon}
      {label}
    </button>
  );
}

function LeftPanel() {
  const schema = useStore((s) => s.schema);
  const selected = useStore((s) => s.selection.tables);
  const actions = useStore((s) => s.actions);
  return (
    <aside
      className="w-56 shrink-0 overflow-auto border-r p-2 text-sm"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
    >
      <div
        className="px-1 pb-1 text-xs font-medium uppercase tracking-wide"
        style={{ color: 'var(--text-muted)' }}
      >
        Tables ({schema.tables.length})
      </div>
      {schema.tables.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => actions.selectTable(t.id)}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:opacity-80"
          style={{
            background: selected.has(t.id) ? 'var(--bg-elevated)' : 'transparent',
            color: 'var(--text)',
          }}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: t.color ?? 'var(--accent)' }}
          />
          <span className="truncate">{t.name}</span>
          <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
            {t.columns.length}
          </span>
        </button>
      ))}
      {schema.enums.length > 0 && (
        <>
          <div
            className="mt-3 px-1 pb-1 text-xs font-medium uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            Enums ({schema.enums.length})
          </div>
          {schema.enums.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-2 px-2 py-1"
              style={{ color: 'var(--text)' }}
            >
              <span className="truncate">{e.name}</span>
              <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
                {e.values.length}
              </span>
            </div>
          ))}
        </>
      )}
    </aside>
  );
}

function RightPanel() {
  const schema = useStore((s) => s.schema);
  const selectedIds = useStore((s) => s.selection.tables);
  const actions = useStore((s) => s.actions);
  const id = [...selectedIds][0] as TableId | undefined;
  const table: Table | undefined = id ? schema.tables.find((t) => t.id === id) : undefined;

  return (
    <aside
      className="w-72 shrink-0 overflow-auto border-l p-3 text-sm"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
    >
      <div className="mb-2 font-medium" style={{ color: 'var(--text-muted)' }}>
        Inspector
      </div>
      {!table ? (
        <p style={{ color: 'var(--text-muted)' }}>Select a table to edit its properties.</p>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Name
            </span>
            <input
              value={table.name}
              onChange={(e) => actions.updateTable(table.id, { name: e.target.value })}
              className="mt-0.5 w-full rounded border px-2 py-1"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--bg-elevated)',
                color: 'var(--text)',
              }}
            />
          </label>
          <div>
            <div className="mb-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              Columns ({table.columns.length})
            </div>
            <div className="space-y-1">
              {table.columns.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded px-2 py-1"
                  style={{ background: 'var(--bg-elevated)' }}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    {c.type.name}
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => actions.addColumn(table.id)}
              className="mt-2 w-full rounded border px-2 py-1 text-xs hover:opacity-80"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              + Add column
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function BottomPanel() {
  const diagnostics = useStore((s) => s.diagnostics);
  const tab = useStore((s) => s.ui.bottomPanel.tab);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  return (
    <div
      className="max-h-40 shrink-0 overflow-auto border-t text-sm"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
    >
      <div className="flex items-center gap-1 px-2 py-1">
        <span className="rounded px-2 py-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          Diagnostics ({diagnostics.length})
        </span>
      </div>
      <div className="px-3 pb-2">
        {diagnostics.length === 0 ? (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {tab === 'diagnostics' ? 'No problems.' : ''}
          </span>
        ) : (
          diagnostics.map((d, i) => (
            <div key={`${d.code}-${i}`} className="flex items-center gap-2 py-0.5 text-xs">
              <span
                style={{
                  color:
                    d.severity === 'error'
                      ? '#dc2626'
                      : d.severity === 'warning'
                        ? '#d97706'
                        : 'var(--text-muted)',
                }}
              >
                ●
              </span>
              <span className="mono" style={{ color: 'var(--text-muted)' }}>
                {d.code}
              </span>
              <span style={{ color: 'var(--text)' }}>{d.message}</span>
            </div>
          ))
        )}
        {errors.length > 0 && (
          <div className="mt-1 text-xs" style={{ color: '#dc2626' }}>
            Canvas shows the last valid schema while errors are present.
          </div>
        )}
      </div>
    </div>
  );
}

const SAMPLES = ['ecommerce'] as const;

function EmptyState() {
  const actions = useStore((s) => s.actions);
  const loadSample = async (name: string) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${name}.pgl`);
      const text = await res.text();
      actions.loadSchema(parse(text).schema);
    } catch {
      // ignore — offline/dev without the file
    }
  };
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center"
      style={{ background: 'var(--canvas-bg)' }}
    >
      <div className="text-center">
        <Database
          size={40}
          className="mx-auto mb-3 opacity-40"
          style={{ color: 'var(--text-muted)' }}
        />
        <p className="mb-1 font-medium" style={{ color: 'var(--text)' }}>
          Start designing
        </p>
        <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          Create a table, or open a sample schema.
        </p>
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={() => actions.addTable()}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: 'var(--accent)' }}
          >
            New table
          </button>
          {SAMPLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => loadSample(s)}
              className="rounded-md border px-3 py-1.5 text-sm capitalize"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              {s} sample
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
