// Migration diff UI (PRD §9.7): pick a From and To source, see the ordered,
// risk-coloured op list, the generated SQL, a summary, and enum ambiguities.
import { Check, Copy, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { parse } from '../dsl/parser.ts';
import type { Schema } from '../model/types.ts';
import { diff } from '../sql/diff/differ.ts';
import { renderOps, summarize } from '../sql/diff/render.ts';
import type { DiffOp, Risk } from '../sql/diff/types.ts';
import { importSql } from '../sql/import/ddl-parser.ts';
import { useStore } from '../store/index.ts';
import { Dialog } from './Dialog.tsx';

type SourceKind = 'current' | 'sql' | 'pgl';

const RISK_COLOR: Record<Risk, string> = {
  safe: 'var(--text-muted)',
  lock: '#d97706',
  destructive: '#dc2626',
  lossy: '#dc2626',
};

function useSchemaFrom(kind: SourceKind, text: string, current: Schema): Schema | null {
  return useMemo(() => {
    try {
      if (kind === 'current') return current;
      if (kind === 'sql') return importSql(text).schema;
      return parse(text).schema;
    } catch {
      return null;
    }
  }, [kind, text, current]);
}

export function DiffDialog({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.schema);
  const [fromKind, setFromKind] = useState<SourceKind>('sql');
  const [toKind, setToKind] = useState<SourceKind>('current');
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [strategy, setStrategy] = useState<'by_id' | 'heuristic' | 'never'>('heuristic');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [copied, setCopied] = useState(false);

  const fromSchema = useSchemaFrom(fromKind, fromText, current);
  const toSchema = useSchemaFrom(toKind, toText, current);

  const result = useMemo(() => {
    if (!fromSchema || !toSchema) return null;
    // by_id is only meaningful when both sides share entity ids (same project,
    // e.g. current vs a snapshot). A pasted SQL/.pgl source has fresh ids, so
    // fall back to heuristic matching there regardless of the selector.
    const shareIds = fromKind === 'current' && toKind === 'current';
    const effective = strategy === 'by_id' && !shareIds ? 'heuristic' : strategy;
    return diff(fromSchema, toSchema, { renameStrategy: effective });
  }, [fromSchema, toSchema, strategy, fromKind, toKind]);

  // ops after applying ambiguity choices + op exclusions
  const activeOps = useMemo(() => {
    if (!result) return [];
    const ops: DiffOp[] = [...result.ops];
    result.ambiguities.forEach((amb, i) => {
      const choice = chosen[i] ?? 0;
      ops.push(...(amb.options[choice]?.ops ?? []));
    });
    // exclude toggled-off ops + anything depending on them (transitive)
    const dead = new Set(excluded);
    let changed = true;
    while (changed) {
      changed = false;
      for (const op of ops) {
        if (!dead.has(op.id) && op.dependsOn.some((d) => dead.has(d))) {
          dead.add(op.id);
          changed = true;
        }
      }
    }
    return ops.filter((o) => !dead.has(o.id));
  }, [result, excluded, chosen]);

  const sql = useMemo(
    () => (activeOps.length ? renderOps(activeOps) : '-- No changes.\n'),
    [activeOps],
  );

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copy = async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const download = () => {
    const blob = new Blob([sql], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'migration.sql';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog title="Diff / migration" onClose={onClose} wide>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <SourcePicker
          label="From (old)"
          kind={fromKind}
          setKind={setFromKind}
          text={fromText}
          setText={setFromText}
        />
        <SourcePicker
          label="To (new)"
          kind={toKind}
          setKind={setToKind}
          text={toText}
          setText={setToText}
        />
      </div>

      <div className="mb-2 flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        <label className="flex items-center gap-1.5">
          Renames:
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as typeof strategy)}
            className="rounded border px-1.5 py-0.5"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--text)',
            }}
          >
            <option value="by_id">by id (same project)</option>
            <option value="heuristic">heuristic (imported)</option>
            <option value="never">never (drop+create)</option>
          </select>
        </label>
        {result && <span>{summarize(result)}</span>}
        {result?.hasDataLoss && <span style={{ color: '#dc2626' }}>⚠ data loss</span>}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1.5 rounded border px-2.5 py-1"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={download}
            className="flex items-center gap-1.5 rounded border px-2.5 py-1"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <Download size={13} /> Download
          </button>
        </div>
      </div>

      {!result ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Provide both sources to compute a migration.
        </p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
          {/* left: op list */}
          <div
            className="max-h-[52vh] overflow-auto rounded border p-2 text-xs"
            style={{ borderColor: 'var(--border)' }}
          >
            {result.ops.length === 0 ? (
              <span style={{ color: 'var(--text-muted)' }}>No structural changes.</span>
            ) : (
              result.ops.map((op) => (
                <label key={op.id} className="flex items-start gap-1.5 py-0.5">
                  <input
                    type="checkbox"
                    checked={!excluded.has(op.id)}
                    onChange={() => toggle(op.id)}
                    className="mt-0.5"
                  />
                  <span style={{ color: RISK_COLOR[op.risk] }}>●</span>
                  <span className="mono truncate" style={{ color: 'var(--text)' }}>
                    {op.kind}
                  </span>
                </label>
              ))
            )}
            {result.ambiguities.map((amb, i) => (
              <div
                key={amb.message}
                className="mt-2 rounded border p-1.5"
                style={{ borderColor: '#d97706' }}
              >
                <div className="mb-1" style={{ color: '#d97706' }}>
                  Ambiguity: {amb.message}
                </div>
                {amb.options.map((opt, j) => (
                  <label key={opt.label} className="flex items-start gap-1.5 py-0.5">
                    <input
                      type="radio"
                      name={`amb-${i}`}
                      checked={(chosen[i] ?? 0) === j}
                      onChange={() => setChosen((c) => ({ ...c, [i]: j }))}
                      className="mt-0.5"
                    />
                    <span style={{ color: 'var(--text)' }}>{opt.label}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>

          {/* right: SQL */}
          <pre
            className="max-h-[52vh] overflow-auto rounded border p-3 text-xs mono"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
          >
            {sql}
          </pre>
        </div>
      )}
    </Dialog>
  );
}

function SourcePicker({
  label,
  kind,
  setKind,
  text,
  setText,
}: {
  label: string;
  kind: SourceKind;
  setKind: (k: SourceKind) => void;
  text: string;
  setText: (t: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--text)' }}>
          {label}
        </span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as SourceKind)}
          className="rounded border px-1.5 py-0.5 text-xs"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-elevated)',
            color: 'var(--text)',
          }}
        >
          <option value="current">Current schema</option>
          <option value="sql">Paste SQL</option>
          <option value="pgl">Paste .pgl</option>
        </select>
      </div>
      {kind === 'current' ? (
        <div
          className="flex h-24 items-center justify-center rounded border text-xs"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          the schema currently on the canvas
        </div>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === 'sql' ? 'CREATE TABLE ...' : 'table ... { }'}
          spellCheck={false}
          className="mono h-24 w-full resize-none rounded border p-2 text-xs"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
        />
      )}
    </div>
  );
}
