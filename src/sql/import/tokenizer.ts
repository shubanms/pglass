// SQL tokenizer for the DDL importer. Handles the lexical hazards in real
// pg_dump output (PRD §13.3): dollar-quoted strings, nested parens, E'' and
// doubled-quote escapes, double-quoted identifiers, and statement splitting on
// ';' only at paren depth 0 and outside any string.

export type SqlTokKind =
  | 'ident' // bare or double-quoted identifier
  | 'keyword' // upper-cased reserved word (same lexeme as ident, classified by parser)
  | 'string' // '...'  content decoded
  | 'number'
  | 'punct' // ( ) , . ; [ ]
  | 'op' // operators like >= etc (kept raw)
  | 'eof';

export interface SqlToken {
  kind: SqlTokKind;
  value: string;
  /** true if the identifier was double-quoted (preserves case, not a keyword) */
  quoted?: boolean;
  from: number;
  to: number;
}

/**
 * Split a SQL string into individual statements. Respects single/double/dollar
 * quotes and parenthesis nesting so semicolons inside them don't split.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i]!;
    if (c === "'") {
      i = skipSingleQuoted(sql, i);
      continue;
    }
    if (c === '"') {
      i = skipDoubleQuoted(sql, i);
      continue;
    }
    if (c === '$') {
      const dq = matchDollarTag(sql, i);
      if (dq) {
        i = skipDollarQuoted(sql, i, dq);
        continue;
      }
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) {
      const stmt = sql.slice(start, i).trim();
      if (stmt) out.push(stmt);
      start = i + 1;
    }
    i++;
  }
  const tail = sql.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function skipSingleQuoted(sql: string, i: number): number {
  i++; // opening '
  const n = sql.length;
  while (i < n) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return i;
}

function skipDoubleQuoted(sql: string, i: number): number {
  i++;
  const n = sql.length;
  while (i < n) {
    if (sql[i] === '"') {
      if (sql[i + 1] === '"') {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return i;
}

function matchDollarTag(sql: string, i: number): string | null {
  const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
  return m ? m[0] : null;
}

function skipDollarQuoted(sql: string, i: number, tag: string): number {
  const end = sql.indexOf(tag, i + tag.length);
  return end < 0 ? sql.length : end + tag.length;
}

const NUM = /[0-9]/;
const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/** Tokenize a single statement into a flat token list. */
export function tokenize(stmt: string): SqlToken[] {
  const toks: SqlToken[] = [];
  let i = 0;
  const n = stmt.length;

  while (i < n) {
    const c = stmt[i]!;
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (c === '-' && stmt[i + 1] === '-') {
      while (i < n && stmt[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && stmt[i + 1] === '*') {
      i += 2;
      while (i < n && !(stmt[i] === '*' && stmt[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    const start = i;

    // dollar-quoted string → keep raw (used inside function bodies; rare in DDL)
    if (c === '$') {
      const tag = matchDollarTag(stmt, i);
      if (tag) {
        const end = stmt.indexOf(tag, i + tag.length);
        const to = end < 0 ? n : end + tag.length;
        toks.push({
          kind: 'string',
          value: stmt.slice(i + tag.length, end < 0 ? n : end),
          from: start,
          to,
        });
        i = to;
        continue;
      }
    }

    // E'...' escape string — treat like a normal string, keep content raw
    if ((c === 'E' || c === 'e') && stmt[i + 1] === "'") {
      i++; // skip E
      const { value, to } = readSingle(stmt, i);
      toks.push({ kind: 'string', value, from: start, to });
      i = to;
      continue;
    }
    if (c === "'") {
      const { value, to } = readSingle(stmt, i);
      toks.push({ kind: 'string', value, from: start, to });
      i = to;
      continue;
    }
    if (c === '"') {
      const { value, to } = readDouble(stmt, i);
      toks.push({ kind: 'ident', value, quoted: true, from: start, to });
      i = to;
      continue;
    }
    if (NUM.test(c)) {
      let v = '';
      while (i < n && (NUM.test(stmt[i]!) || stmt[i] === '.')) {
        v += stmt[i];
        i++;
      }
      toks.push({ kind: 'number', value: v, from: start, to: i });
      continue;
    }
    if (IDENT_START.test(c)) {
      let v = '';
      while (i < n && IDENT_PART.test(stmt[i]!)) {
        v += stmt[i];
        i++;
      }
      toks.push({ kind: 'ident', value: v, from: start, to: i });
      continue;
    }
    if ('(),.;[]'.includes(c)) {
      i++;
      toks.push({ kind: 'punct', value: c, from: start, to: i });
      continue;
    }
    // operators / misc — accumulate a run of operator chars
    let v = '';
    while (i < n && !/[\sA-Za-z0-9_'"(),.;[\]]/.test(stmt[i]!)) {
      v += stmt[i];
      i++;
    }
    if (v === '') {
      v = stmt[i]!;
      i++;
    }
    toks.push({ kind: 'op', value: v, from: start, to: i });
  }
  toks.push({ kind: 'eof', value: '', from: n, to: n });
  return toks;
}

function readSingle(stmt: string, i: number): { value: string; to: number } {
  i++; // opening '
  const n = stmt.length;
  let v = '';
  while (i < n) {
    if (stmt[i] === "'") {
      if (stmt[i + 1] === "'") {
        v += "'";
        i += 2;
        continue;
      }
      return { value: v, to: i + 1 };
    }
    if (stmt[i] === '\\' && i + 1 < n) {
      v += stmt[i + 1];
      i += 2;
      continue;
    }
    v += stmt[i];
    i++;
  }
  return { value: v, to: i };
}

function readDouble(stmt: string, i: number): { value: string; to: number } {
  i++;
  const n = stmt.length;
  let v = '';
  while (i < n) {
    if (stmt[i] === '"') {
      if (stmt[i + 1] === '"') {
        v += '"';
        i += 2;
        continue;
      }
      return { value: v, to: i + 1 };
    }
    v += stmt[i];
    i++;
  }
  return { value: v, to: i };
}
