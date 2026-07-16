// Unified code-generation dialog: pick a target (Postgres DDL, Prisma, Drizzle,
// SQLAlchemy, TypeORM, Zod, TypeScript, Mermaid, PlantUML, DBML, Markdown, JSON
// Schema, seed data) and copy/download the output. PRD §11.
import { Check, Copy, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GENERATORS } from '../generators/index.ts';
import { useStore } from '../store/index.ts';
import { Dialog } from './Dialog.tsx';

export function GenerateDialog({ onClose }: { onClose: () => void }) {
  const schema = useStore((s) => s.schema);
  const [active, setActive] = useState('ddl');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const gen = GENERATORS.find((g) => g.id === active)!;

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    Promise.resolve(gen.run(schema))
      .then((out) => {
        if (!cancelled) setOutput(out);
      })
      .catch((e) => {
        if (!cancelled) setOutput(`-- generation failed: ${(e as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gen, schema]);

  const copy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const download = () => {
    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = gen.filename(schema.name || 'schema');
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog title="Generate / export" onClose={onClose} wide>
      <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-3">
        <div className="flex flex-col gap-0.5">
          {GENERATORS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setActive(g.id)}
              className="rounded px-2.5 py-1.5 text-left text-sm hover:opacity-80"
              style={{
                background: g.id === active ? 'var(--bg-panel)' : 'transparent',
                color: g.id === active ? 'var(--text)' : 'var(--text-muted)',
                fontWeight: g.id === active ? 600 : 400,
              }}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="mb-2 flex items-center gap-2">
            <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>
              {gen.filename(schema.name || 'schema')}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={copy}
                className="flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={download}
                className="flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                <Download size={13} /> Download
              </button>
            </div>
          </div>
          <pre
            className="mono max-h-[60vh] min-h-[40vh] overflow-auto rounded border p-3 text-xs"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
          >
            {busy ? 'Generating…' : output}
          </pre>
        </div>
      </div>
    </Dialog>
  );
}
