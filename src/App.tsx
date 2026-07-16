import {
  ChevronDown,
  ChevronUp,
  Columns2,
  Database,
  FileDown,
  FileUp,
  FolderOpen,
  GitCompare,
  LayoutGrid,
  Moon,
  PanelBottom,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  Save,
  Sun,
  X,
} from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from './canvas/Canvas.tsx';
import { parse } from './dsl/parser.ts';
import { lint, sortDiagnostics } from './lint/engine.ts';
import type { Diagnostic, Table, TableId } from './model/types.ts';
import { useStore } from './store/index.ts';
import { CommandPalette, type PaletteItem } from './ui/CommandPalette.tsx';
import { DiffDialog } from './ui/DiffDialog.tsx';
import { EditorPane } from './ui/EditorPane.tsx';
import { ExportImageDialog } from './ui/ExportImageDialog.tsx';
import { GenerateDialog } from './ui/GenerateDialog.tsx';
import { ImportDialog } from './ui/ImportDialog.tsx';
import { Resizer } from './ui/Resizer.tsx';
import { type Persistence, usePersistence } from './ui/usePersistence.ts';
import { useShortcuts } from './ui/useShortcuts.ts';

type DialogKind = 'import' | 'export' | 'diff' | 'image' | null;
const DialogCtx = createContext<(d: DialogKind) => void>(() => {});
const PersistCtx = createContext<Persistence | null>(null);

function useAppliedTheme() {
  const theme = useStore((s) => s.ui.theme);
  useEffect(() => {
    const resolve = () =>
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme; // 'light' | 'dark' | 'presentation' pass through
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const persist = usePersistence();

  const shortcutHandlers = useMemo(
    () => ({
      openPalette: () => setPaletteOpen(true),
      openImport: () => setDialog('import'),
      openExport: () => setDialog('export'),
      openDiff: () => setDialog('diff'),
      openImage: () => setDialog('image'),
      save: () => persist.save(),
    }),
    [persist],
  );
  useShortcuts(shortcutHandlers);

  const commands = usePaletteCommands({
    openImport: () => setDialog('import'),
    openExport: () => setDialog('export'),
    openImage: () => setDialog('image'),
    openDiff: () => setDialog('diff'),
    save: () => persist.save(),
    open: () => persist.open(),
  });

  return (
    <PersistCtx.Provider value={persist}>
      <DialogCtx.Provider value={setDialog}>
        <div className="flex h-full flex-col">
          <TopBar />
          <div className="flex min-h-0 flex-1">
            {ui.leftPanel && (
              <>
                <LeftPanel />
                <SplitHandle dim="leftWidth" sign={1} aria-label="Resize table list" />
              </>
            )}
            <main className="flex min-w-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1">
                {ui.editorPane !== 'hidden' && ui.editorPane !== 'full' && hasTables && (
                  <>
                    <div className="shrink-0" style={{ width: ui.layout.editorWidth }}>
                      <EditorPane />
                    </div>
                    <SplitHandle dim="editorWidth" sign={1} aria-label="Resize editor" />
                  </>
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
              {ui.bottomPanel.open && (
                <SplitHandle dim="bottomHeight" sign={-1} aria-label="Resize diagnostics" />
              )}
              <BottomPanel />
            </main>
            {ui.rightPanel && (
              <>
                <SplitHandle dim="rightWidth" sign={-1} aria-label="Resize inspector" />
                <RightPanel />
              </>
            )}
          </div>
        </div>
        {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
        {dialog === 'export' && <GenerateDialog onClose={() => setDialog(null)} />}
        {dialog === 'diff' && <DiffDialog onClose={() => setDialog(null)} />}
        {dialog === 'image' && <ExportImageDialog onClose={() => setDialog(null)} />}
        {paletteOpen && (
          <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
        )}
        {persist.toast && <Toast message={persist.toast} onClose={persist.dismissToast} />}
      </DialogCtx.Provider>
    </PersistCtx.Provider>
  );
}

function SplitHandle({
  dim,
  sign,
  'aria-label': ariaLabel,
}: {
  dim: keyof import('./store/index.ts').PanelLayout;
  sign: 1 | -1;
  'aria-label': string;
}) {
  const setLayout = useStore((s) => s.actions.setLayout);
  const base = useRef(0);
  return (
    <Resizer
      orientation={dim === 'bottomHeight' ? 'horizontal' : 'vertical'}
      aria-label={ariaLabel}
      onStart={() => {
        base.current = useStore.getState().ui.layout[dim];
      }}
      onDelta={(d) => setLayout({ [dim]: base.current + sign * d })}
    />
  );
}

function usePaletteCommands(cb: {
  openImport: () => void;
  openExport: () => void;
  openImage: () => void;
  openDiff: () => void;
  save: () => void;
  open: () => void;
}): PaletteItem[] {
  const actions = useStore((s) => s.actions);
  const theme = useStore((s) => s.ui.theme);
  return useMemo(() => {
    const cmd = (id: string, label: string, run: () => void, hint?: string): PaletteItem => ({
      id,
      label,
      hint,
      group: 'Command',
      run,
    });
    return [
      cmd('new-table', 'New table', () => actions.addTable(), 'T'),
      cmd('layout-layered', 'Auto-layout: layered', () => void actions.autoLayout('layered'), '⌘G'),
      cmd('layout-force', 'Auto-layout: force', () => void actions.autoLayout('force')),
      cmd('layout-radial', 'Auto-layout: radial', () => void actions.autoLayout('radial')),
      cmd('fit', 'Zoom to fit', () => actions.requestFit(), 'F'),
      cmd('focus', 'Focus selection', () => actions.focusSelection(), '⇧F'),
      cmd('select-all', 'Select all tables', () => actions.selectAllTables(), '⌘A'),
      cmd('duplicate', 'Duplicate selection', () => actions.duplicateSelection(), '⌘D'),
      cmd('import', 'Import SQL…', cb.openImport),
      cmd('export', 'Export code…', cb.openExport, '⌘E'),
      cmd('image', 'Export image…', cb.openImage),
      cmd('diff', 'Diff schemas…', cb.openDiff),
      cmd('save', 'Save project', cb.save, '⌘S'),
      cmd('open', 'Open project…', cb.open),
      cmd('undo', 'Undo', () => actions.undo(), '⌘Z'),
      cmd('redo', 'Redo', () => actions.redo(), '⇧⌘Z'),
      cmd('theme-dark', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', () =>
        actions.setUi('theme', theme === 'dark' ? 'light' : 'dark'),
      ),
      cmd('theme-presentation', 'Presentation theme (high contrast)', () =>
        actions.setUi('theme', 'presentation'),
      ),
      cmd('toggle-editor', 'Toggle editor pane', () =>
        actions.setUi(
          'editorPane',
          useStore.getState().ui.editorPane === 'hidden' ? 'split' : 'hidden',
        ),
      ),
      cmd('toggle-left', 'Toggle table list', () => actions.toggleUi('leftPanel')),
      cmd('toggle-right', 'Toggle inspector', () => actions.toggleUi('rightPanel')),
      cmd('toggle-bottom', 'Toggle diagnostics panel', () => {
        const bp = useStore.getState().ui.bottomPanel;
        actions.setUi('bottomPanel', { open: !bp.open, tab: bp.tab });
      }),
      cmd('toggle-grid', 'Toggle grid', () => actions.toggleUi('showGrid')),
      cmd('toggle-snap', 'Toggle snap to grid', () => actions.toggleUi('snapToGrid')),
      cmd('toggle-minimap', 'Toggle minimap', () => actions.toggleUi('showMinimap')),
      cmd('toggle-compact', 'Toggle compact columns', () => actions.toggleUi('compactColumns')),
      cmd('toggle-focus', 'Toggle focus mode', () => actions.toggleUi('focusMode')),
      cmd('cycle-edges', 'Cycle edge style', () => {
        const order = ['orthogonal', 'bezier', 'straight'] as const;
        const cur = useStore.getState().ui.edgeStyle;
        actions.setUi('edgeStyle', order[(order.indexOf(cur) + 1) % order.length]!);
      }),
    ];
  }, [actions, theme, cb]);
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      className="pgl-toast fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md border px-3 py-2 text-sm shadow-lg"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--bg-elevated)',
        color: 'var(--text)',
      }}
    >
      {message}
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        style={{ color: 'var(--text-muted)' }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function TopBar() {
  const theme = useStore((s) => s.ui.theme);
  const actions = useStore((s) => s.actions);
  const editorPane = useStore((s) => s.ui.editorPane);
  const leftPanel = useStore((s) => s.ui.leftPanel);
  const rightPanel = useStore((s) => s.ui.rightPanel);
  const bottomOpen = useStore((s) => s.ui.bottomPanel.open);
  const setDialog = useContext(DialogCtx);
  const persist = useContext(PersistCtx);
  const hasTables = useStore((s) => s.schema.tables.length > 0);
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-2 border-b px-3"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
    >
      <div className="flex items-center gap-2 font-semibold">
        <Database size={18} style={{ color: 'var(--accent)' }} />
        <span>Pglass</span>
      </div>
      {persist?.fileName && (
        <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>
          {persist.fileName}
        </span>
      )}
      <div className="flex-1" />
      <ToolbarButton icon={<FolderOpen size={15} />} label="Open" onClick={() => persist?.open()} />
      <ToolbarButton
        icon={<Save size={15} />}
        label="Save"
        onClick={() => persist?.save()}
        disabled={!hasTables}
      />
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

      <div className="mx-1 h-5 w-px" style={{ background: 'var(--border)' }} />

      <IconToggle
        active={leftPanel}
        onClick={() => actions.toggleUi('leftPanel')}
        label="Toggle table list (⌘B)"
      >
        <PanelLeft size={16} />
      </IconToggle>
      <IconToggle
        active={editorPane !== 'hidden'}
        onClick={() => actions.setUi('editorPane', editorPane === 'hidden' ? 'split' : 'hidden')}
        label="Toggle editor (⌘\\)"
      >
        <Columns2 size={16} />
      </IconToggle>
      <IconToggle
        active={bottomOpen}
        onClick={() =>
          actions.setUi('bottomPanel', {
            open: !bottomOpen,
            tab: useStore.getState().ui.bottomPanel.tab,
          })
        }
        label="Toggle diagnostics (⌘/)"
      >
        <PanelBottom size={16} />
      </IconToggle>
      <IconToggle
        active={rightPanel}
        onClick={() => actions.toggleUi('rightPanel')}
        label="Toggle inspector"
      >
        <PanelRight size={16} />
      </IconToggle>

      <div className="mx-1 h-5 w-px" style={{ background: 'var(--border)' }} />

      <button
        type="button"
        onClick={() => actions.setUi('theme', dark ? 'light' : 'dark')}
        className="pgl-hover rounded-md p-1.5"
        style={{ color: 'var(--text-muted)' }}
        aria-label="Toggle theme"
        title="Toggle light / dark"
      >
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </header>
  );
}

function IconToggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className="pgl-hover rounded-md p-1.5 transition-colors"
      style={{
        color: active ? 'var(--text)' : 'var(--text-muted)',
        background: active ? 'var(--bg-hover)' : 'transparent',
      }}
    >
      {children}
    </button>
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
      className="pgl-hover flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
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

function PanelHeader({
  title,
  count,
  onCollapse,
  collapseLabel,
  children,
}: {
  title: string;
  count?: number;
  onCollapse: () => void;
  collapseLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="flex h-9 shrink-0 items-center gap-1.5 px-3"
      style={{ color: 'var(--text-muted)' }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider">
        {title}
        {count !== undefined && <span className="ml-1 opacity-60">{count}</span>}
      </span>
      <div className="flex-1" />
      {children}
      <button
        type="button"
        onClick={onCollapse}
        aria-label={collapseLabel}
        title={collapseLabel}
        className="pgl-hover -mr-1 rounded p-1"
      >
        <PanelLeftClose size={14} />
      </button>
    </div>
  );
}

function LeftPanel() {
  const schema = useStore((s) => s.schema);
  const selected = useStore((s) => s.selection.tables);
  const actions = useStore((s) => s.actions);
  const width = useStore((s) => s.ui.layout.leftWidth);
  return (
    <aside
      className="flex shrink-0 flex-col overflow-hidden border-r"
      style={{ width, borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
    >
      <PanelHeader
        title="Tables"
        count={schema.tables.length}
        onCollapse={() => actions.setUi('leftPanel', false)}
        collapseLabel="Hide table list"
      />
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2 text-[13px]">
        {schema.tables.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => actions.revealTable(t.id)}
            className="pgl-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
            style={{
              background: selected.has(t.id) ? 'var(--accent-soft)' : 'transparent',
              color: 'var(--text)',
            }}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
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
              className="mt-4 mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              Enums <span className="opacity-60">{schema.enums.length}</span>
            </div>
            {schema.enums.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5"
                style={{ color: 'var(--text)' }}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ background: 'var(--text-muted)', opacity: 0.5 }}
                />
                <span className="truncate">{e.name}</span>
                <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
                  {e.values.length}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

const INSPECTOR_SWATCHES = ['#4F46E5', '#059669', '#dc2626', '#d97706', '#7c3aed', '#0891b2'];

function parseTypeInput(input: string): { name: string; args: number[]; arrayDims: number } {
  const arrayDims = (input.match(/\[\]/g) ?? []).length;
  const base = input.replace(/\[\]/g, '').trim();
  const m = /^([a-z0-9_ ]+?)\s*(?:\(([\d,\s]+)\))?$/i.exec(base);
  if (!m) return { name: base || 'text', args: [], arrayDims };
  const args = m[2]
    ? m[2]
        .split(',')
        .map((n) => Number.parseInt(n.trim(), 10))
        .filter((n) => !Number.isNaN(n))
    : [];
  return { name: (m[1] ?? 'text').trim().toLowerCase(), args, arrayDims };
}

function RightPanel() {
  const schema = useStore((s) => s.schema);
  const selectedIds = useStore((s) => s.selection.tables);
  const actions = useStore((s) => s.actions);
  const id = [...selectedIds][0] as TableId | undefined;
  const table: Table | undefined = id ? schema.tables.find((t) => t.id === id) : undefined;

  const width = useStore((s) => s.ui.layout.rightWidth);
  return (
    <aside
      className="flex shrink-0 flex-col overflow-hidden border-l"
      style={{ width, borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
    >
      <div
        className="flex h-9 shrink-0 items-center gap-1.5 px-3"
        style={{ color: 'var(--text-muted)' }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider">Inspector</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => actions.setUi('rightPanel', false)}
          aria-label="Hide inspector"
          title="Hide inspector"
          className="pgl-hover -mr-1 rounded p-1"
        >
          <PanelRightClose size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 text-[13px]">
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
                className="mt-0.5 w-full rounded border px-2 py-1 outline-none focus:ring-2"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text)',
                }}
              />
            </label>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {INSPECTOR_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Colour ${c}`}
                    onClick={() => actions.updateTable(table.id, { color: c })}
                    className="h-4 w-4 rounded-full ring-1 ring-black/10 transition-transform hover:scale-125"
                    style={{
                      background: c,
                      outline: table.color === c ? '2px solid var(--text)' : 'none',
                      outlineOffset: '1px',
                    }}
                  />
                ))}
              </div>
              <label
                className="flex items-center gap-1.5 text-xs"
                style={{ color: 'var(--text-muted)' }}
              >
                <input
                  type="checkbox"
                  checked={!!table.rowLevelSecurity}
                  onChange={(e) =>
                    actions.updateTable(table.id, { rowLevelSecurity: e.target.checked })
                  }
                />
                RLS
              </label>
            </div>

            <div>
              <div className="mb-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                Columns ({table.columns.length})
              </div>
              <div className="space-y-1">
                {table.columns.map((c) => (
                  <InspectorColumn
                    key={c.id}
                    tableId={table.id}
                    column={c}
                    isPk={table.primaryKey.includes(c.id)}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => actions.addColumn(table.id)}
                className="mt-2 w-full rounded border px-2 py-1 text-xs transition-transform hover:opacity-80 active:scale-[0.99]"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                + Add column
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function InspectorColumn({
  tableId,
  column,
  isPk,
}: {
  tableId: TableId;
  column: import('./model/types.ts').Column;
  isPk: boolean;
}) {
  const actions = useStore((s) => s.actions);
  const schema = useStore((s) => s.schema);
  const [hover, setHover] = useState(false);

  const togglePk = () => {
    const t = schema.tables.find((x) => x.id === tableId);
    if (!t) return;
    const pk = isPk ? t.primaryKey.filter((id) => id !== column.id) : [...t.primaryKey, column.id];
    actions.updateTable(tableId, { primaryKey: pk });
  };

  return (
    <div
      className="flex items-center gap-1 rounded px-1.5 py-1 transition-colors"
      style={{ background: 'var(--bg-elevated)' }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={togglePk}
        title="Toggle primary key"
        className="shrink-0 rounded px-1 text-[10px] font-bold"
        style={{ color: isPk ? '#d97706' : 'var(--text-muted)', opacity: isPk ? 1 : 0.4 }}
      >
        PK
      </button>
      <input
        value={column.name}
        onChange={(e) => actions.updateColumn(tableId, column.id, { name: e.target.value })}
        className="min-w-0 flex-1 rounded bg-transparent px-1 outline-none focus:ring-1"
        style={{ color: 'var(--text)' }}
      />
      <input
        value={typeStrOf(column)}
        onChange={(e) =>
          actions.updateColumn(tableId, column.id, { type: parseTypeInput(e.target.value) })
        }
        className="mono w-20 shrink-0 rounded bg-transparent px-1 text-right text-[11px] outline-none focus:ring-1"
        style={{ color: 'var(--text-muted)' }}
      />
      <button
        type="button"
        onClick={() => actions.updateColumn(tableId, column.id, { notNull: !column.notNull })}
        title="Toggle NOT NULL"
        className="shrink-0 rounded px-1 text-[10px] font-bold"
        style={{
          color: column.notNull ? 'var(--accent)' : 'var(--text-muted)',
          opacity: column.notNull ? 1 : 0.4,
        }}
      >
        NN
      </button>
      <button
        type="button"
        onClick={() => actions.deleteColumn(tableId, column.id)}
        aria-label="Delete column"
        className="shrink-0 rounded px-0.5"
        style={{ color: '#dc2626', opacity: hover ? 0.9 : 0 }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

function typeStrOf(c: import('./model/types.ts').Column): string {
  let s = c.type.name;
  if (c.type.args.length) s += `(${c.type.args.join(',')})`;
  s += '[]'.repeat(c.type.arrayDims);
  return s;
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
  const open = useStore((s) => s.ui.bottomPanel.open);
  const height = useStore((s) => s.ui.layout.bottomHeight);
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
      className="flex shrink-0 flex-col border-t"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
    >
      {/* header strip — always visible, doubles as the collapse toggle */}
      <div className="flex h-8 shrink-0 items-center gap-1 px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => actions.setUi('bottomPanel', { open: true, tab: t.id })}
            className="pgl-hover rounded-md px-2.5 py-1 text-xs"
            style={{
              background: open && tab === t.id ? 'var(--accent-soft)' : 'transparent',
              color: open && tab === t.id ? 'var(--text)' : 'var(--text-muted)',
              fontWeight: tab === t.id ? 600 : 400,
            }}
          >
            {t.label} <span className="opacity-60">{t.count}</span>
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => actions.setUi('bottomPanel', { open: !open, tab })}
          aria-label={open ? 'Collapse panel' : 'Expand panel'}
          title={open ? 'Collapse (⌘/)' : 'Expand (⌘/)'}
          className="pgl-hover rounded p-1"
          style={{ color: 'var(--text-muted)' }}
        >
          {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
      </div>
      {open && (
        <div
          className="overflow-auto px-3 py-1.5 text-[13px]"
          style={{ height, borderTop: '1px solid var(--border)' }}
        >
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
      )}
    </div>
  );
}

const SAMPLES: { id: string; label: string; desc: string }[] = [
  { id: 'ecommerce', label: 'Ecommerce', desc: 'Orders, products & inventory' },
  { id: 'saas', label: 'SaaS multi-tenant', desc: 'Orgs, members & billing' },
  { id: 'northwind', label: 'Northwind', desc: 'The classic demo schema' },
];

function EmptyState() {
  const actions = useStore((s) => s.actions);
  const setDialog = useContext(DialogCtx);
  const loadSample = async (name: string) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${name}.pgl`);
      const text = await res.text();
      actions.loadSchema(parse(text).schema);
    } catch {
      // ignore — offline/dev without the file
    }
  };
  const ActionCard = ({
    title,
    desc,
    onClick,
    primary,
  }: {
    title: string;
    desc: string;
    onClick: () => void;
    primary?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="flex w-44 flex-col gap-1 rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5"
      style={{
        borderColor: primary ? 'var(--accent)' : 'var(--border)',
        background: 'var(--bg-elevated)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <span
        className="text-sm font-semibold"
        style={{ color: primary ? 'var(--accent)' : 'var(--text)' }}
      >
        {title}
      </span>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {desc}
      </span>
    </button>
  );

  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center p-6"
      style={{ background: 'var(--canvas-bg)' }}
    >
      <div className="w-full max-w-lg text-center">
        <Database
          size={44}
          className="mx-auto mb-4 opacity-30"
          style={{ color: 'var(--text-muted)' }}
        />
        <h1 className="mb-1 text-xl font-semibold" style={{ color: 'var(--text)' }}>
          Design a Postgres schema
        </h1>
        <p className="mb-6 text-sm" style={{ color: 'var(--text-muted)' }}>
          Start from scratch, bring your own SQL, or open a sample. Press{' '}
          <kbd
            className="mono rounded px-1.5 py-0.5 text-[11px]"
            style={{ background: 'var(--bg-hover)' }}
          >
            ⌘K
          </kbd>{' '}
          any time for the command palette.
        </p>
        <div className="mb-6 flex flex-wrap justify-center gap-3">
          <ActionCard
            title="New table"
            desc="Start with a blank canvas"
            onClick={() => actions.addTable()}
            primary
          />
          <ActionCard
            title="Import SQL"
            desc="Paste a pg_dump or DDL"
            onClick={() => setDialog('import')}
          />
        </div>
        <div
          className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          Sample schemas
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => loadSample(s.id)}
              className="flex w-44 flex-col gap-0.5 rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--bg-elevated)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <span className="text-[13px] font-medium" style={{ color: 'var(--text)' }}>
                {s.label}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {s.desc}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
