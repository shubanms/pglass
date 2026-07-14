import { Database, FileDown, FileUp, GitCompare, LayoutGrid, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export function App() {
  const [theme, toggleTheme] = useTheme();

  return (
    <div className="flex h-full flex-col">
      <TopBar theme={theme} onToggleTheme={toggleTheme} />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <main className="flex min-w-0 flex-1 flex-col">
          <CanvasPlaceholder />
          <BottomPanel />
        </main>
        <RightPanel />
      </div>
    </div>
  );
}

function TopBar({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  return (
    <header
      className="flex h-11 shrink-0 items-center gap-3 border-b px-3"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
    >
      <div className="flex items-center gap-2 font-semibold">
        <Database size={18} style={{ color: 'var(--accent)' }} />
        <span>Pglass</span>
      </div>
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
        untitled.pgl
      </span>
      <div className="flex-1" />
      <ToolbarButton icon={<FileUp size={15} />} label="Import" />
      <ToolbarButton icon={<FileDown size={15} />} label="Export" />
      <ToolbarButton icon={<GitCompare size={15} />} label="Diff" />
      <ToolbarButton icon={<LayoutGrid size={15} />} label="Layout" />
      <button
        type="button"
        onClick={onToggleTheme}
        className="ml-1 rounded p-1.5 hover:opacity-80"
        style={{ color: 'var(--text-muted)' }}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </header>
  );
}

function ToolbarButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm hover:opacity-80"
      style={{ color: 'var(--text)' }}
    >
      {icon}
      {label}
    </button>
  );
}

function LeftPanel() {
  return (
    <aside
      className="w-56 shrink-0 overflow-auto border-r p-3 text-sm"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
    >
      <div className="mb-2 font-medium" style={{ color: 'var(--text-muted)' }}>
        Outline
      </div>
      <p style={{ color: 'var(--text-muted)' }}>No schema yet.</p>
    </aside>
  );
}

function RightPanel() {
  return (
    <aside
      className="w-72 shrink-0 overflow-auto border-l p-3 text-sm"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
    >
      <div className="mb-2 font-medium" style={{ color: 'var(--text-muted)' }}>
        Inspector
      </div>
      <p style={{ color: 'var(--text-muted)' }}>Select a table to edit its properties.</p>
    </aside>
  );
}

function CanvasPlaceholder() {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center"
      style={{ background: 'var(--canvas-bg)' }}
    >
      <div className="text-center" style={{ color: 'var(--text-muted)' }}>
        <Database size={40} className="mx-auto mb-3 opacity-40" />
        <p className="font-medium">Empty canvas</p>
        <p className="text-sm">Start from scratch, import SQL, or open a sample.</p>
      </div>
    </div>
  );
}

function BottomPanel() {
  const tabs = ['Diagnostics', 'Lint', 'Diff', 'Output'];
  return (
    <div
      className="h-9 shrink-0 border-t"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
    >
      <div className="flex h-full items-center gap-1 px-2 text-sm">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className="rounded px-2.5 py-1 hover:opacity-80"
            style={{ color: 'var(--text-muted)' }}
          >
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
}
