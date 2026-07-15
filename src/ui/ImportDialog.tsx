import { useState } from 'react';
import type { Diagnostic } from '../model/types.ts';
import { useStore } from '../store/index.ts';
import { Dialog } from './Dialog.tsx';

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const actions = useStore((s) => s.actions);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<{ diagnostics: Diagnostic[]; done: boolean } | null>(null);

  const doImport = () => {
    const diagnostics = actions.importSqlText(sql);
    setResult({ diagnostics, done: true });
    if (diagnostics.filter((d) => d.severity === 'error').length === 0) {
      setTimeout(onClose, 600);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSql(await file.text());
  };

  const errors = result?.diagnostics.filter((d) => d.severity === 'error') ?? [];
  const infos = result?.diagnostics.filter((d) => d.severity !== 'error') ?? [];

  return (
    <Dialog title="Import SQL" onClose={onClose} wide>
      <p className="mb-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        Paste <code>pg_dump --schema-only</code> output or any Postgres DDL, or choose a file.
      </p>
      <input type="file" accept=".sql,.txt" onChange={onFile} className="mb-2 text-sm" />
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        placeholder="CREATE TABLE ..."
        spellCheck={false}
        className="mono h-64 w-full resize-none rounded border p-2 text-xs"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
      />
      {result && (
        <div className="mt-2 text-xs">
          {errors.length === 0 ? (
            <span style={{ color: '#059669' }}>
              Imported. {infos.length > 0 && `${infos.length} note(s).`}
            </span>
          ) : (
            <div style={{ color: '#dc2626' }}>
              {errors.slice(0, 5).map((d, i) => (
                <div key={`${d.code}-${i}`}>
                  {d.code}: {d.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded border px-3 py-1.5 text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={doImport}
          disabled={!sql.trim()}
          className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          Import
        </button>
      </div>
    </Dialog>
  );
}
