// pg_dump preprocessing (PRD §13.1): strip the noise, capture what matters.
// Returns cleaned statements plus captured extensions and preserved raw objects
// (views/functions/triggers/sequences) that we round-trip verbatim.
import { splitStatements } from './tokenizer.ts';

export interface PreprocessResult {
  /** statements we will actually parse */
  statements: string[];
  extensions: string[];
  rawObjects: { kind: string; name: string; sql: string }[];
  /** count of objects preserved but not modelled */
  preservedCount: number;
}

const DROP_PREFIXES = [
  /^set\s/i,
  /^select\s+pg_catalog\./i,
  /^\\/, // \connect, \.
  /^alter\s+.*\bowner\s+to\b/i,
  /^grant\s/i,
  /^revoke\s/i,
];

const RAW_KINDS: { re: RegExp; kind: string }[] = [
  { re: /^create\s+(or\s+replace\s+)?function\b/i, kind: 'function' },
  { re: /^create\s+(or\s+replace\s+)?procedure\b/i, kind: 'procedure' },
  { re: /^create\s+trigger\b/i, kind: 'trigger' },
  { re: /^create\s+(or\s+replace\s+)?view\b/i, kind: 'view' },
  { re: /^create\s+materialized\s+view\b/i, kind: 'materialized view' },
  { re: /^create\s+aggregate\b/i, kind: 'aggregate' },
];

export function preprocess(sql: string): PreprocessResult {
  // Strip COPY ... FROM stdin; ... \.  blocks before statement splitting.
  const withoutCopy = stripCopyBlocks(sql);
  const statements = splitStatements(withoutCopy);

  const kept: string[] = [];
  const extensions: string[] = [];
  const rawObjects: { kind: string; name: string; sql: string }[] = [];

  for (const stmt of statements) {
    const s = stmt.trim();
    if (!s) continue;

    if (DROP_PREFIXES.some((re) => re.test(s))) continue;

    const ext = /^create\s+extension\s+(if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/i.exec(s);
    if (ext) {
      extensions.push(ext[2]!.toLowerCase());
      continue;
    }

    const rawKind = RAW_KINDS.find((r) => r.re.test(s));
    if (rawKind) {
      rawObjects.push({ kind: rawKind.kind, name: extractName(s), sql: s });
      continue;
    }

    // CREATE SEQUENCE / ALTER SEQUENCE — captured; the nextval() default is
    // normalized into identity by the DDL parser, so we don't re-emit these.
    if (/^create\s+sequence\b/i.test(s) || /^alter\s+sequence\b/i.test(s)) {
      continue;
    }

    kept.push(s);
  }

  return {
    statements: kept,
    extensions,
    rawObjects,
    preservedCount: rawObjects.length,
  };
}

function stripCopyBlocks(sql: string): string {
  const lines = sql.split('\n');
  const out: string[] = [];
  let inCopy = false;
  for (const line of lines) {
    if (!inCopy && /^copy\s.+from\s+stdin/i.test(line.trim())) {
      inCopy = true;
      continue;
    }
    if (inCopy) {
      if (line.trim() === '\\.') inCopy = false;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function extractName(stmt: string): string {
  const m =
    /^create\s+(?:or\s+replace\s+)?(?:materialized\s+)?\w+\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_.]+)"?/i.exec(
      stmt,
    );
  return m ? m[1]! : '(unnamed)';
}
