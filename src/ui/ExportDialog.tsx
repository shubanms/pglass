import { Check, Copy, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEFAULT_DDL_OPTIONS, type DdlOptions, exportDDL } from '../sql/export/ddl-writer.ts';
import { useStore } from '../store/index.ts';
import { Dialog } from './Dialog.tsx';

const TOGGLES: { key: keyof DdlOptions; label: string }[] = [
  { key: 'ifNotExists', label: 'IF NOT EXISTS' },
  { key: 'includeDropPrelude', label: 'DROP prelude' },
  { key: 'includeIndexes', label: 'Indexes' },
  { key: 'includeComments', label: 'Comments' },
  { key: 'includeExtensions', label: 'Extensions' },
];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const schema = useStore((s) => s.schema);
  const [opts, setOpts] = useState<DdlOptions>(DEFAULT_DDL_OPTIONS);
  const [copied, setCopied] = useState(false);

  const ddl = useMemo(() => exportDDL(schema, opts), [schema, opts]);

  const copy = async () => {
    await navigator.clipboard.writeText(ddl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const download = () => {
    const blob = new Blob([ddl], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${schema.name || 'schema'}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog title="Export Postgres DDL" onClose={onClose} wide>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        {TOGGLES.map((t) => (
          <label
            key={t.key}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: 'var(--text)' }}
          >
            <input
              type="checkbox"
              checked={opts[t.key]}
              onChange={(e) => setOpts((o) => ({ ...o, [t.key]: e.target.checked }))}
            />
            {t.label}
          </label>
        ))}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={download}
            className="flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <Download size={13} />
            Download
          </button>
        </div>
      </div>
      <pre
        className="mono max-h-[60vh] overflow-auto rounded border p-3 text-xs"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
      >
        {ddl}
      </pre>
      <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        Serial columns are emitted as <code>GENERATED ... AS IDENTITY</code> (serial is legacy).
      </p>
    </Dialog>
  );
}
