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
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Canvas } from './canvas/Canvas.tsx';
import { parse } from './dsl/parser.ts';
import { lint, sortDiagnostics } from './lint/engine.ts';
import type { Diagnostic, Table, TableId } from './model/types.ts';
import { useStore } from './store/index.ts';
import { DiffDialog } from './ui/DiffDialog.tsx';
import { EditorPane } from './ui/EditorPane.tsx';
import { GenerateDialog } from './ui/GenerateDialog.tsx';
import { ImportDialog } from './ui/ImportDialog.tsx';

type DialogKind = 'import' | 'export' | 'diff' | null;
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
      {dialog === 'export' && <GenerateDialog onClose={() => setDialog(null)} />}
      {dialog === 'diff' && <DiffDialog onClose={() => setDialog(null)} />}
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
      <ToolbarButton
        icon={<GitCompare size={15} />}
        label="Diff"
        onClick={() => setDialog('diff')}
      />
      <LayoutMenu />
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

function LayoutMenu() {
  const actions = useStore((s) => s.actions);
  const hasTables = useStore((s) => s.schema.tables.length > 0);
  const hasSelection = useStore((s) => s.selection.tables.size > 0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (algo: 'layered' | 'force' | 'radial', selectionOnly = false) => {
    setOpen(false);
    setBusy(true);
    try {
      await actions.autoLayout(algo, selectionOnly);
    } finally {
      setBusy(false);
    }
  };

  const items: { label: string; algo: 'layered' | 'force' | 'radial'; sel?: boolean }[] = [
    { label: 'Layered (hierarchical)', algo: 'layered' },
    { label: 'Force (interconnected)', algo: 'force' },
    { label: 'Radial', algo: 'radial' },
  ];

  return (
    <div className="relative">
      <ToolbarButton
        icon={<LayoutGrid size={15} />}
        label={busy ? 'Laying out…' : 'Layout'}
        onClick={() => hasTables && setOpen((o) => !o)}
        disabled={!hasTables || busy}
      />
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute right-0 z-50 mt-1 w-56 rounded-md border py-1 shadow-lg"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
          >
            {items.map((it) => (
              <button
                key={it.algo}
                type="button"
                onClick={() => run(it.algo)}
                className="block w-full px-3 py-1.5 text-left text-sm hover:opacity-80"
                style={{ color: 'var(--text)' }}
              >
                {it.label}
              </button>
            ))}
            {hasSelection && (
              <>
                <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
                <button
                  type="button"
                  onClick={() => run('layered', true)}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:opacity-80"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Layout selection only
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
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

function severityColor(sev: string): string {
  return sev === 'error' ? '#dc2626' : sev === 'warning' ? '#d97706' : 'var(--text-muted)';
}

function DiagnosticRow({ d, i }: { d: Diagnostic; i: number }) {
  const actions = useStore((s) => s.actions);
  return (
    <div key={`${d.code}-${i}`} className="flex items-center gap-2 py-0.5 text-xs">
      <span style={{ color: severityColor(d.severity) }}>●</span>
      <span className="mono" style={{ color: 'var(--text-muted)' }}>
        {d.code}
      </span>
      <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text)' }}>
        {d.message}
      </span>
      {d.fix && (
        <button
          type="button"
          onClick={() => actions.applyFix(d)}
          className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] hover:opacity-80"
          style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
          title={d.fix.title}
        >
          Fix
        </button>
      )}
    </div>
  );
}

function BottomPanel() {
  const parseDiagnostics = useStore((s) => s.diagnostics);
  const schema = useStore((s) => s.schema);
  const tab = useStore((s) => s.ui.bottomPanel.tab);
  const actions = useStore((s) => s.actions);

  const lintResults = useMemo(() => sortDiagnostics(lint(schema)), [schema]);
  const active = tab === 'lint' ? lintResults : parseDiagnostics;
  const parseErrors = parseDiagnostics.filter((d) => d.severity === 'error');

  const tabs: { id: 'diagnostics' | 'lint'; label: string; count: number }[] = [
    { id: 'diagnostics', label: 'Diagnostics', count: parseDiagnostics.length },
    { id: 'lint', label: 'Lint', count: lintResults.length },
  ];

  return (
    <div
      className="flex max-h-48 shrink-0 flex-col border-t text-sm"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
    >
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
        style={{ borderColor: 'var(--border)' }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => actions.setUi('bottomPanel', { open: true, tab: t.id })}
            className="rounded px-2.5 py-0.5 text-xs"
            style={{
              background: tab === t.id ? 'var(--bg-elevated)' : 'transparent',
              color: tab === t.id ? 'var(--text)' : 'var(--text-muted)',
              fontWeight: tab === t.id ? 600 : 400,
            }}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-1.5">
        {active.length === 0 ? (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {tab === 'lint' ? 'No lint findings.' : 'No problems.'}
          </span>
        ) : (
          active.map((d, i) => <DiagnosticRow key={`${d.code}-${i}`} d={d} i={i} />)
        )}
        {tab === 'diagnostics' && parseErrors.length > 0 && (
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
