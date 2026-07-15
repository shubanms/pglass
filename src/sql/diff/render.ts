// Render a DiffResult's ops to runnable SQL, annotating every non-safe op with
// its warning as a leading `--` comment. See PRD §9.3 / §9.7.
import type { DiffOp, DiffOptions, DiffResult } from './types.ts';

export function renderOps(ops: DiffOp[], opts?: Partial<DiffOptions>): string {
  const lines: string[] = [];
  const transactional = opts?.transactional ?? true;
  const concurrent = opts?.concurrentIndexes ?? false;
  // CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
  const wrap = transactional && !concurrent && ops.length > 0;

  if (wrap) lines.push('BEGIN;', '');
  for (const op of ops) {
    if (op.risk !== 'safe' && op.warning) {
      lines.push(`-- [${op.risk}] ${op.warning}`);
    } else if (op.warning) {
      lines.push(`-- ${op.warning}`);
    }
    lines.push(op.sql);
    lines.push('');
  }
  if (wrap) lines.push('COMMIT;');

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

export function renderDiff(result: DiffResult, opts?: Partial<DiffOptions>): string {
  if (result.ops.length === 0) return '-- No changes.\n';
  return renderOps(result.ops, opts);
}

/** A compact "+3 tables, ~2 columns, -1 index" style summary (§9.7 right pane). */
export function summarize(result: DiffResult): string {
  const counts = { create: 0, alter: 0, drop: 0 };
  for (const op of result.ops) {
    if (op.kind.startsWith('create') || op.kind.startsWith('add')) counts.create++;
    else if (op.kind.startsWith('drop')) counts.drop++;
    else counts.alter++;
  }
  const parts: string[] = [];
  if (counts.create) parts.push(`+${counts.create}`);
  if (counts.alter) parts.push(`~${counts.alter}`);
  if (counts.drop) parts.push(`-${counts.drop}`);
  return parts.join(' ') || 'no changes';
}
