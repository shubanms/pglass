// DDL parser: turns preprocessed Postgres statements into a Schema.
// Handles the statements pg_dump actually emits (PRD §13.2): CREATE TABLE with
// inline + table constraints, CREATE TYPE AS ENUM, CREATE INDEX, ALTER TABLE ...
// ADD CONSTRAINT (pg_dump emits PKs/FKs this way), SET DEFAULT nextval()
// normalization, and COMMENT ON.
import {
  newColumnId,
  newEnumId,
  newIndexId,
  newRelId,
  newRoutineId,
  newTableId,
  newTriggerId,
  newViewId,
} from '../../model/ids.ts';
import { emptySchema } from '../../model/schema.ts';
import type {
  Column,
  ColumnId,
  Diagnostic,
  EnumType,
  Index,
  IndexKey,
  IndexMethod,
  PgType,
  RefAction,
  Relationship,
  Schema,
  Table,
} from '../../model/types.ts';
import { arityAccepts, canonicalTypeName, isBuiltinType, lookupType } from '../types.ts';
import { preprocess } from './pgdump-preprocess.ts';
import { type SqlToken, tokenize } from './tokenizer.ts';

export interface ImportResult {
  schema: Schema;
  diagnostics: Diagnostic[];
}

const SERIAL_MAP: Record<string, string> = {
  smallserial: 'smallint',
  serial2: 'smallint',
  serial: 'integer',
  serial4: 'integer',
  bigserial: 'bigint',
  serial8: 'bigint',
};

export function importSql(sql: string, now = new Date().toISOString()): ImportResult {
  const pre = preprocess(sql);
  const schema = emptySchema('imported', now);
  schema.meta.extensions = pre.extensions.length ? pre.extensions : undefined;
  schema.meta.rawObjects = pre.rawObjects.length ? pre.rawObjects : undefined;
  const diagnostics: Diagnostic[] = [];

  // Deferred work that needs all tables to exist first.
  const deferredConstraints: (() => void)[] = [];
  const enumsByName = new Map<string, EnumType>();

  const findTable = (qualified: string): Table | undefined => {
    const [ns, nm] = splitQual(qualified);
    return schema.tables.find(
      (t) =>
        t.namespace.toLowerCase() === ns.toLowerCase() && t.name.toLowerCase() === nm.toLowerCase(),
    );
  };

  for (const stmt of pre.statements) {
    try {
      const toks = tokenize(stmt);
      const p = new StmtParser(toks, stmt);
      const head = p.peekWord();

      if (p.matchWords('CREATE', 'SCHEMA')) {
        p.matchWords('IF', 'NOT', 'EXISTS');
        const name = p.ident();
        if (name && !schema.namespaces.includes(name)) schema.namespaces.push(name);
      } else if (p.matchWords('CREATE', 'TYPE')) {
        parseCreateType(p, schema, enumsByName, diagnostics);
      } else if (p.matchWords('CREATE', 'TABLE')) {
        parseCreateTable(p, schema, enumsByName, deferredConstraints, findTable, diagnostics);
      } else if (
        head === 'CREATE' &&
        (p.lookaheadWords('CREATE', 'UNIQUE', 'INDEX') || p.lookaheadWords('CREATE', 'INDEX'))
      ) {
        deferredConstraints.push(() => parseCreateIndex(stmt, schema, findTable, diagnostics));
      } else if (head === 'ALTER' && /\balter\s+table\b/i.test(stmt)) {
        deferredConstraints.push(() => parseAlterTable(stmt, schema, findTable, diagnostics));
      } else if (head === 'COMMENT') {
        deferredConstraints.push(() => parseComment(stmt, schema, findTable));
      }
      // anything else: silently ignored (already filtered in preprocess)
    } catch (e) {
      diagnostics.push({
        severity: 'warning',
        code: 'SQL_PARSE',
        message: `Could not parse statement: ${(e as Error).message}`,
      });
    }
  }

  for (const fn of deferredConstraints) {
    try {
      fn();
    } catch (e) {
      diagnostics.push({
        severity: 'warning',
        code: 'SQL_PARSE',
        message: `Could not apply constraint: ${(e as Error).message}`,
      });
    }
  }

  // Promote captured CREATE VIEW / FUNCTION / TRIGGER objects to first-class
  // model entities; leave anything else (procedures we can't parse, aggregates…)
  // in the raw bucket.
  promoteRawObjects(schema, findTable);

  return { schema, diagnostics };
}

const VIEW_RE =
  /^create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_.]+)"?\s*(?:\([^)]*\))?\s+as\s+([\s\S]*)$/i;

function promoteRawObjects(schema: Schema, findTable: (q: string) => Table | undefined) {
  const raw = schema.meta.rawObjects;
  if (!raw) return;
  const remaining: { kind: string; name: string; sql: string }[] = [];
  for (const obj of raw) {
    if (obj.kind === 'view' || obj.kind === 'materialized view') {
      const m = VIEW_RE.exec(obj.sql.trim());
      if (m) {
        const [ns, name] = splitQual(m[1]!);
        schema.views.push({
          id: newViewId(),
          namespace: ns || 'public',
          name,
          query: m[2]!.trim().replace(/;\s*$/, '').trim(),
          materialized: obj.kind === 'materialized view',
        });
        continue;
      }
    } else if (obj.kind === 'function') {
      const fn = parseFunctionSql(obj.sql);
      if (fn) {
        schema.routines.push({ id: newRoutineId(), ...fn });
        continue;
      }
    } else if (obj.kind === 'trigger') {
      const tg = parseTriggerSql(obj.sql);
      const table = tg ? findTable(`${tg.tableNamespace}.${tg.tableName}`) : undefined;
      if (tg && table) {
        schema.triggers.push({
          id: newTriggerId(),
          name: tg.name,
          table: table.id,
          timing: tg.timing,
          events: tg.events,
          level: tg.level,
          functionName: tg.functionName,
        });
        continue;
      }
    }
    remaining.push(obj);
  }
  schema.meta.rawObjects = remaining.length ? remaining : undefined;
}

function trimBody(body: string): string {
  return body.trim();
}

function parseFunctionSql(sql: string): {
  namespace: string;
  name: string;
  args: string;
  returns: string;
  language: string;
  body: string;
} | null {
  const s = sql.trim();
  const head = /^create\s+(?:or\s+replace\s+)?function\s+("?[a-z0-9_.]+"?)\s*\(/i.exec(s);
  if (!head) return null;
  const [ns, name] = splitQual(head[1]!.replace(/"/g, ''));
  // args: balanced parens starting at the '(' the head match ends on
  const openIdx = head.index + head[0].length - 1;
  let depth = 0;
  let argsEnd = -1;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) {
        argsEnd = i;
        break;
      }
    }
  }
  if (argsEnd < 0) return null;
  const args = s.slice(openIdx + 1, argsEnd).trim();
  const rest = s.slice(argsEnd + 1);
  const returns =
    /\breturns\s+([\s\S]*?)\s+(?:language|as|stable|volatile|immutable|strict|security|cost|rows|parallel|set|window|leakproof)\b/i
      .exec(rest)?.[1]
      ?.trim()
      .replace(/\s+/g, ' ') ??
    /\breturns\s+([a-z0-9_.[\]]+)/i.exec(rest)?.[1] ??
    '';
  const language = /\blanguage\s+"?([a-z0-9_]+)"?/i.exec(rest)?.[1]?.toLowerCase() ?? 'sql';
  let body = '';
  const dollar = /\bas\s+(\$[a-z0-9_]*\$)([\s\S]*?)\1/i.exec(rest);
  if (dollar) body = dollar[2]!;
  else {
    const single = /\bas\s+'([\s\S]*?)'\s*(?:language|;|$)/i.exec(rest);
    if (single) body = single[1]!.replace(/''/g, "'");
  }
  return { namespace: ns || 'public', name, args, returns, language, body: trimBody(body) };
}

const TRIGGER_EVENTS = ['insert', 'update', 'delete', 'truncate'] as const;

function parseTriggerSql(sql: string): {
  name: string;
  tableNamespace: string;
  tableName: string;
  timing: 'before' | 'after' | 'instead of';
  events: ('insert' | 'update' | 'delete' | 'truncate')[];
  level: 'row' | 'statement';
  functionName: string;
} | null {
  const s = sql.trim();
  const m =
    /^create\s+(?:constraint\s+)?trigger\s+"?([a-z0-9_]+)"?\s+(before|after|instead\s+of)\s+([\s\S]*?)\s+on\s+("?[a-z0-9_.]+"?)/i.exec(
      s,
    );
  if (!m) return null;
  const timing = m[2]!.toLowerCase().replace(/\s+/g, ' ') as 'before' | 'after' | 'instead of';
  const eventsRaw = m[3]!;
  const events = TRIGGER_EVENTS.filter((e) => new RegExp(`\\b${e}\\b`, 'i').test(eventsRaw));
  const [ns, tableName] = splitQual(m[4]!.replace(/"/g, ''));
  const level = /for\s+each\s+statement/i.test(s) ? 'statement' : 'row';
  const fnMatch = /execute\s+(?:function|procedure)\s+"?([a-z0-9_.]+)"?/i.exec(s);
  const functionName = fnMatch ? splitQual(fnMatch[1]!.replace(/"/g, ''))[1] : '';
  return {
    name: m[1]!,
    tableNamespace: ns || 'public',
    tableName,
    timing,
    events: events.length ? events : ['insert'],
    level,
    functionName,
  };
}

// ─── CREATE TYPE ... AS ENUM ─────────────────────────────────────────────
function parseCreateType(
  p: StmtParser,
  schema: Schema,
  enumsByName: Map<string, EnumType>,
  diagnostics: Diagnostic[],
) {
  const qname = p.qualifiedName();
  if (!qname) return;
  if (!p.matchWords('AS', 'ENUM')) {
    diagnostics.push({
      severity: 'info',
      code: 'SQL_UNSUPPORTED_TYPE',
      message: `Only ENUM user types are modelled; "${qname.name}" preserved as unknown`,
    });
    return;
  }
  const values: string[] = [];
  p.expectPunct('(');
  while (!p.atPunct(')') && !p.atEof()) {
    if (p.atPunct(',')) {
      p.next();
      continue;
    }
    const v = p.stringValue();
    if (v !== null) values.push(v);
    else p.next();
  }
  p.expectPunct(')');
  const en: EnumType = {
    id: newEnumId(),
    namespace: qname.namespace,
    name: qname.name,
    values,
  };
  schema.enums.push(en);
  enumsByName.set(`${en.namespace.toLowerCase()}.${en.name.toLowerCase()}`, en);
  enumsByName.set(en.name.toLowerCase(), en);
}

// ─── CREATE TABLE ────────────────────────────────────────────────────────
function parseCreateTable(
  p: StmtParser,
  schema: Schema,
  enumsByName: Map<string, EnumType>,
  deferred: (() => void)[],
  findTable: (q: string) => Table | undefined,
  diagnostics: Diagnostic[],
) {
  p.matchWords('IF', 'NOT', 'EXISTS');
  const qname = p.qualifiedName();
  if (!qname) return;

  const table: Table = {
    id: newTableId(),
    namespace: qname.namespace,
    name: qname.name,
    columns: [],
    primaryKey: [],
    checks: [],
    pos: { x: 0, y: 0 },
  };
  if (!schema.namespaces.includes(qname.namespace)) schema.namespaces.push(qname.namespace);

  p.expectPunct('(');
  // parse comma-separated items at paren depth 1
  while (!p.atPunct(')') && !p.atEof()) {
    if (p.atPunct(',')) {
      p.next();
      continue;
    }
    const kw = p.peekWord();
    if (
      kw === 'PRIMARY' ||
      kw === 'FOREIGN' ||
      kw === 'UNIQUE' ||
      kw === 'CHECK' ||
      kw === 'CONSTRAINT' ||
      kw === 'EXCLUDE'
    ) {
      parseTableConstraint(p, table, schema, deferred, findTable, diagnostics);
    } else {
      parseColumnDef(p, table, enumsByName, schema, deferred, findTable, diagnostics);
    }
    // skip to next comma at this depth
    p.skipToItemBoundary();
  }
  p.expectPunct(')');

  schema.tables.push(table);
}

function parseColumnDef(
  p: StmtParser,
  table: Table,
  enumsByName: Map<string, EnumType>,
  schema: Schema,
  deferred: (() => void)[],
  findTable: (q: string) => Table | undefined,
  diagnostics: Diagnostic[],
) {
  const name = p.ident();
  if (!name) {
    p.next();
    return;
  }
  const type = parseType(p, enumsByName);
  const col: Column = {
    id: newColumnId(),
    name,
    type,
    notNull: false,
    unique: false,
    identity: 'none',
    generated: { kind: 'none' },
  };

  // serial → integer + identity
  if (SERIAL_MAP[type.name]) {
    col.type = { ...type, name: SERIAL_MAP[type.name]! };
    col.identity = 'by_default';
  }

  // inline column constraints
  for (;;) {
    const w = p.peekWord();
    if (w === null || p.atPunct(',') || p.atPunct(')')) break;
    if (p.matchWords('NOT', 'NULL')) col.notNull = true;
    else if (p.matchWords('NULL')) col.notNull = false;
    else if (p.matchWords('PRIMARY', 'KEY')) {
      table.primaryKey.push(col.id);
      col.notNull = true;
    } else if (p.matchWords('UNIQUE')) col.unique = true;
    else if (p.matchWords('DEFAULT')) {
      col.default = readDefaultExpr(p, col);
    } else if (p.matchWords('GENERATED')) {
      if (p.matchWords('ALWAYS', 'AS', 'IDENTITY')) {
        col.identity = 'always';
        p.skipParens();
      } else if (p.matchWords('BY', 'DEFAULT', 'AS', 'IDENTITY')) {
        col.identity = 'by_default';
        p.skipParens();
      } else if (p.matchWords('ALWAYS', 'AS')) {
        const expr = p.parenGroupRaw();
        p.matchWords('STORED');
        col.generated = { kind: 'stored', expr };
      }
    } else if (p.matchWords('CHECK')) {
      col.check = p.parenGroupRaw();
    } else if (p.matchWords('COLLATE')) {
      col.collation = p.ident() ?? undefined;
    } else if (p.matchWords('REFERENCES')) {
      // inline FK
      const target = p.qualifiedName();
      const targetCols: string[] = [];
      if (p.atPunct('(')) {
        p.next();
        while (!p.atPunct(')') && !p.atEof()) {
          if (p.atPunct(',')) {
            p.next();
            continue;
          }
          const c = p.ident();
          if (c) targetCols.push(c);
          else p.next();
        }
        p.expectPunct(')');
      }
      const onDelete = readRefActions(p);
      if (target) {
        deferred.push(() =>
          addForeignKey(
            schema,
            table,
            [name],
            target,
            targetCols,
            onDelete.del,
            onDelete.upd,
            undefined,
            findTable,
            diagnostics,
          ),
        );
      }
    } else {
      // unknown token in a column def — skip it
      p.next();
    }
  }

  table.columns.push(col);
}

function parseTableConstraint(
  p: StmtParser,
  table: Table,
  schema: Schema,
  deferred: (() => void)[],
  findTable: (q: string) => Table | undefined,
  diagnostics: Diagnostic[],
) {
  let constraintName: string | undefined;
  if (p.matchWords('CONSTRAINT')) constraintName = p.ident() ?? undefined;

  if (p.matchWords('PRIMARY', 'KEY')) {
    const cols = p.parenIdentList();
    deferred.push(() => {
      table.primaryKey = cols
        .map((c) => table.columns.find((x) => x.name.toLowerCase() === c.toLowerCase())?.id)
        .filter((x): x is ColumnId => !!x);
    });
  } else if (p.matchWords('UNIQUE')) {
    const cols = p.parenIdentList();
    deferred.push(() => addUniqueIndex(schema, table, cols, constraintName));
  } else if (p.matchWords('FOREIGN', 'KEY')) {
    const srcCols = p.parenIdentList();
    p.matchWords('REFERENCES');
    const target = p.qualifiedName();
    const tgtCols = p.atPunct('(') ? p.parenIdentList() : [];
    const actions = readRefActions(p);
    if (target) {
      deferred.push(() =>
        addForeignKey(
          schema,
          table,
          srcCols,
          target,
          tgtCols,
          actions.del,
          actions.upd,
          constraintName,
          findTable,
          diagnostics,
        ),
      );
    }
  } else if (p.matchWords('CHECK')) {
    const expr = p.parenGroupRaw();
    table.checks.push(constraintName ? { name: constraintName, expr } : { expr });
  } else if (p.matchWords('EXCLUDE')) {
    diagnostics.push({
      severity: 'info',
      code: 'SQL_EXCLUDE',
      message: `EXCLUDE constraint on ${table.name} preserved as raw (not modelled)`,
    });
    p.skipParens();
  }
}

// ─── ALTER TABLE (whole statement re-tokenized) ──────────────────────────
function parseAlterTable(
  stmt: string,
  schema: Schema,
  findTable: (q: string) => Table | undefined,
  diagnostics: Diagnostic[],
) {
  const p = new StmtParser(tokenize(stmt), stmt);
  p.matchWords('ALTER', 'TABLE');
  p.matchWords('ONLY');
  const qname = p.qualifiedName();
  if (!qname) return;
  const table = findTable(qname.qualified);
  if (!table) return;

  if (p.matchWords('ENABLE', 'ROW', 'LEVEL', 'SECURITY')) {
    table.rowLevelSecurity = true;
    return;
  }
  if (p.matchWords('ADD')) {
    // Tables already exist in this (deferred) phase, so run the constraint's
    // deferred work immediately.
    const local: (() => void)[] = [];
    parseTableConstraint(p, table, schema, local, findTable, diagnostics);
    runDeferredNow(local);
    return;
  }
  if (p.matchWords('ALTER', 'COLUMN') || p.matchWords('ALTER')) {
    const colName = p.ident();
    const col = table.columns.find((c) => c.name.toLowerCase() === colName?.toLowerCase());
    if (col && p.matchWords('SET', 'DEFAULT')) {
      const def = readDefaultExpr(p, col);
      // nextval(...) default → identity (legacy serial trio)
      if (/nextval\s*\(/i.test(def)) {
        col.identity = 'by_default';
        if (SERIAL_MAP[col.type.name]) col.type = { ...col.type, name: SERIAL_MAP[col.type.name]! };
      } else {
        col.default = def;
      }
    }
  }
}

// The table-constraint parser pushes into `deferred`; when called from ALTER we
// run those immediately since all tables already exist.
function runDeferredNow(fns: (() => void)[]) {
  for (const fn of fns) fn();
}

// ─── CREATE INDEX ────────────────────────────────────────────────────────
function parseCreateIndex(
  stmt: string,
  schema: Schema,
  findTable: (q: string) => Table | undefined,
  _diagnostics: Diagnostic[],
) {
  const p = new StmtParser(tokenize(stmt), stmt);
  p.matchWords('CREATE');
  const unique = p.matchWords('UNIQUE');
  p.matchWords('INDEX');
  p.matchWords('CONCURRENTLY');
  p.matchWords('IF', 'NOT', 'EXISTS');
  // index name is optional
  let name: string | undefined;
  if (!p.lookaheadWords('ON')) name = p.ident() ?? undefined;
  p.matchWords('ON');
  p.matchWords('ONLY');
  const qname = p.qualifiedName();
  const table = qname ? findTable(qname.qualified) : undefined;
  if (!table) return;

  let method: IndexMethod = 'btree';
  if (p.matchWords('USING')) {
    const m = p.ident()?.toLowerCase();
    if (m && ['btree', 'hash', 'gin', 'gist', 'brin', 'spgist'].includes(m))
      method = m as IndexMethod;
  }

  const keys = parseIndexKeys(p, table);
  let include: ColumnId[] | undefined;
  if (p.matchWords('INCLUDE')) {
    const cols = p.parenIdentList();
    include = cols
      .map((c) => table.columns.find((x) => x.name.toLowerCase() === c.toLowerCase())?.id)
      .filter((x): x is ColumnId => !!x);
  }
  let where: string | undefined;
  if (p.matchWords('WHERE')) where = p.restRaw().trim();

  const ix: Index = {
    id: newIndexId(),
    table: table.id,
    name,
    unique,
    method,
    keys,
    include: include?.length ? include : undefined,
    where,
  };
  schema.indexes.push(ix);
}

function parseIndexKeys(p: StmtParser, table: Table): IndexKey[] {
  const keys: IndexKey[] = [];
  p.expectPunct('(');
  let depth = 1;
  let buf: string[] = [];
  const flushExpr = () => {
    const parts = buf;
    buf = [];
    if (parts.length === 0) return;
    // strip one layer of fully-wrapping parens: ( expr )
    const trimmed =
      parts[0] === '(' && parts[parts.length - 1] === ')' ? parts.slice(1, -1) : parts;
    const e = joinTokens(trimmed);
    const m = /^(\w+)(?:\s+(asc|desc))?(?:\s+nulls\s+(first|last))?$/i.exec(e);
    if (m) {
      const col = table.columns.find((c) => c.name.toLowerCase() === m[1]!.toLowerCase());
      if (col) {
        const key: Extract<IndexKey, { kind: 'column' }> = { kind: 'column', column: col.id };
        if (m[2]) key.sort = m[2].toLowerCase() as 'asc' | 'desc';
        if (m[3]) key.nulls = m[3].toLowerCase() as 'first' | 'last';
        keys.push(key);
        return;
      }
    }
    keys.push({ kind: 'expr', expr: e });
  };
  while (!p.atEof()) {
    if (p.atPunct('(')) {
      depth++;
      buf.push('(');
      p.next();
      continue;
    }
    if (p.atPunct(')')) {
      depth--;
      if (depth === 0) {
        p.next();
        break;
      }
      buf.push(')');
      p.next();
      continue;
    }
    if (p.atPunct(',') && depth === 1) {
      flushExpr();
      p.next();
      continue;
    }
    const t = p.next();
    buf.push(t.kind === 'string' ? `'${t.value.replace(/'/g, "''")}'` : t.value);
  }
  flushExpr();
  return keys;
}

// ─── COMMENT ON ──────────────────────────────────────────────────────────
function parseComment(stmt: string, schema: Schema, findTable: (q: string) => Table | undefined) {
  const p = new StmtParser(tokenize(stmt), stmt);
  p.matchWords('COMMENT', 'ON');
  const target = p.peekWord();
  p.next();
  if (target === 'TABLE') {
    const q = p.qualifiedName();
    p.matchWords('IS');
    const text = p.stringValue();
    const t = q ? findTable(q.qualified) : undefined;
    if (t && text !== null) t.comment = text;
  } else if (target === 'COLUMN') {
    const q = p.qualifiedName(); // schema.table.column OR table.column
    p.matchWords('IS');
    const text = p.stringValue();
    if (q && text !== null) {
      const parts = q.qualified.split('.');
      const colName = parts.pop()!;
      const t = findTable(parts.join('.'));
      const col = t?.columns.find((c) => c.name.toLowerCase() === colName.toLowerCase());
      if (col) col.comment = text;
    }
  } else if (target === 'TYPE') {
    const q = p.qualifiedName();
    p.matchWords('IS');
    const text = p.stringValue();
    const en = q
      ? schema.enums.find((e) => e.name.toLowerCase() === q.name.toLowerCase())
      : undefined;
    if (en && text !== null) en.comment = text;
  }
}

// ─── helpers that build model entities ───────────────────────────────────
function addForeignKey(
  schema: Schema,
  srcTable: Table,
  srcColNames: string[],
  target: { qualified: string; namespace: string; name: string },
  tgtColNames: string[],
  onDelete: RefAction,
  onUpdate: RefAction,
  name: string | undefined,
  findTable: (q: string) => Table | undefined,
  diagnostics: Diagnostic[],
) {
  const tgtTable = findTable(target.qualified);
  if (!tgtTable) {
    diagnostics.push({
      severity: 'warning',
      code: 'SQL_FK_TARGET',
      message: `FK on ${srcTable.name} references unknown table ${target.qualified}`,
    });
    return;
  }
  const srcCols = srcColNames
    .map((n) => srcTable.columns.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id)
    .filter((x): x is ColumnId => !!x);
  // default target columns to the target PK when omitted
  const tgtCols = (tgtColNames.length ? tgtColNames : []).length
    ? tgtColNames
        .map((n) => tgtTable.columns.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id)
        .filter((x): x is ColumnId => !!x)
    : tgtTable.primaryKey.slice();
  if (srcCols.length === 0 || srcCols.length !== tgtCols.length) return;

  const rel: Relationship = {
    id: newRelId(),
    name,
    sourceTable: srcTable.id,
    sourceColumns: srcCols,
    targetTable: tgtTable.id,
    targetColumns: tgtCols,
    onDelete,
    onUpdate,
  };
  schema.relationships.push(rel);
}

function addUniqueIndex(schema: Schema, table: Table, colNames: string[], name?: string) {
  const cols = colNames
    .map((n) => table.columns.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id)
    .filter((x): x is ColumnId => !!x);
  if (cols.length === 1) {
    const col = table.columns.find((c) => c.id === cols[0]);
    if (col) {
      col.unique = true;
      return;
    }
  }
  if (cols.length) {
    schema.indexes.push({
      id: newIndexId(),
      table: table.id,
      name,
      unique: true,
      method: 'btree',
      keys: cols.map((c) => ({ kind: 'column', column: c })),
    });
  }
}

// ─── type + expression parsing ───────────────────────────────────────────
function parseType(p: StmtParser, enumsByName: Map<string, EnumType>): PgType {
  // handle multi-word type names: "double precision", "timestamp with time zone",
  // "character varying", "bit varying", "time with time zone"
  let name = p.ident() ?? '';
  // schema-qualified type (e.g. public.mood, public.citext) — keep the last segment
  if (p.atPunct('.')) {
    p.next();
    const seg = p.ident();
    if (seg) name = seg;
  }
  const nl = name.toLowerCase();
  if (nl === 'double' && p.lookaheadWord('precision')) {
    p.next();
    name = 'double precision';
  } else if ((nl === 'character' || nl === 'bit') && p.lookaheadWord('varying')) {
    p.next();
    name = `${nl} varying`;
  } else if ((nl === 'timestamp' || nl === 'time') && p.lookaheadWord('with')) {
    // consume: with time zone / without time zone
    p.next(); // with/without? actually consume the words
    p.matchWords('TIME', 'ZONE');
    name = `${nl} with time zone`;
  } else if ((nl === 'timestamp' || nl === 'time') && p.lookaheadWord('without')) {
    p.next();
    p.matchWords('TIME', 'ZONE');
    name = nl;
  }

  const args: number[] = [];
  if (p.atPunct('(')) {
    p.next();
    while (!p.atPunct(')') && !p.atEof()) {
      if (p.atPunct(',')) {
        p.next();
        continue;
      }
      const num = p.numberValue();
      if (num !== null) args.push(num);
      else p.next();
    }
    p.expectPunct(')');
  }

  let arrayDims = 0;
  while (p.atPunct('[')) {
    p.next();
    p.numberValue(); // optional size, ignored
    if (p.atPunct(']')) p.next();
    arrayDims++;
  }
  // "ARRAY" keyword form
  if (p.lookaheadWord('array')) {
    p.next();
    arrayDims = Math.max(1, arrayDims);
  }

  const canonical = canonicalTypeName(name);
  const spec = lookupType(canonical);
  if (spec && !arityAccepts(spec.arity, args.length)) {
    // tolerate; keep args
  }
  const pg: PgType = { name: canonical, args, arrayDims };
  if (!isBuiltinType(canonical) && !SERIAL_MAP[canonical]) {
    const en = enumsByName.get(canonical.toLowerCase());
    if (en) pg.udtId = en.id;
  }
  return pg;
}

function readDefaultExpr(p: StmtParser, _col: Column): string {
  // Read a default expression up to the next top-level constraint keyword or
  // comma / close paren, preserving parenthesised sub-expressions and strings.
  const stopWords = new Set([
    'NOT',
    'NULL',
    'PRIMARY',
    'UNIQUE',
    'CHECK',
    'REFERENCES',
    'COLLATE',
    'GENERATED',
    'CONSTRAINT',
  ]);
  const parts: string[] = [];
  let depth = 0;
  for (;;) {
    if (p.atEof()) break;
    if (depth === 0 && (p.atPunct(',') || p.atPunct(')'))) break;
    const w = p.peekWord();
    if (depth === 0 && w && stopWords.has(w)) break;
    const t = p.next();
    if (t.value === '(') depth++;
    if (t.value === ')') depth--;
    parts.push(t.kind === 'string' ? `'${t.value.replace(/'/g, "''")}'` : t.value);
  }
  return joinTokens(parts);
}

function readRefActions(p: StmtParser): { del: RefAction; upd: RefAction } {
  let del: RefAction = 'no_action';
  let upd: RefAction = 'no_action';
  for (;;) {
    if (p.matchWords('ON', 'DELETE')) del = readAction(p);
    else if (p.matchWords('ON', 'UPDATE')) upd = readAction(p);
    else if (
      p.matchWords('DEFERRABLE') ||
      p.matchWords('INITIALLY', 'DEFERRED') ||
      p.matchWords('NOT', 'VALID')
    ) {
      // consumed, ignore for model
    } else break;
  }
  return { del, upd };
}

function readAction(p: StmtParser): RefAction {
  if (p.matchWords('CASCADE')) return 'cascade';
  if (p.matchWords('RESTRICT')) return 'restrict';
  if (p.matchWords('SET', 'NULL')) return 'set_null';
  if (p.matchWords('SET', 'DEFAULT')) return 'set_default';
  if (p.matchWords('NO', 'ACTION')) return 'no_action';
  return 'no_action';
}

function joinTokens(parts: string[]): string {
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i]!;
    const prev = parts[i - 1];
    const noSpaceBefore = t === '(' || t === ')' || t === ',' || t === '::' || t === '.';
    const noSpaceAfterPrev = prev === '(' || prev === '::' || prev === '.';
    if (i > 0 && !noSpaceBefore && !noSpaceAfterPrev) out += ' ';
    out += t;
  }
  return out.trim();
}

function splitQual(qualified: string): [string, string] {
  const idx = qualified.indexOf('.');
  if (idx < 0) return ['public', qualified];
  return [qualified.slice(0, idx), qualified.slice(idx + 1)];
}

// ─── token cursor ────────────────────────────────────────────────────────
class StmtParser {
  private i = 0;
  constructor(
    private toks: SqlToken[],
    readonly src: string,
  ) {}

  peek(k = 0): SqlToken {
    return this.toks[Math.min(this.i + k, this.toks.length - 1)]!;
  }
  next(): SqlToken {
    const t = this.peek();
    if (this.i < this.toks.length - 1) this.i++;
    return t;
  }
  atEof(): boolean {
    return this.peek().kind === 'eof';
  }
  peekWord(): string | null {
    const t = this.peek();
    return t.kind === 'ident' && !t.quoted ? t.value.toUpperCase() : null;
  }
  lookaheadWord(word: string): boolean {
    const t = this.peek();
    return t.kind === 'ident' && t.value.toLowerCase() === word.toLowerCase();
  }
  lookaheadWords(...words: string[]): boolean {
    for (let k = 0; k < words.length; k++) {
      const t = this.peek(k);
      if (!(t.kind === 'ident' && t.value.toUpperCase() === words[k]!.toUpperCase())) return false;
    }
    return true;
  }
  matchWords(...words: string[]): boolean {
    if (!this.lookaheadWords(...words)) return false;
    for (let k = 0; k < words.length; k++) this.next();
    return true;
  }
  ident(): string | null {
    const t = this.peek();
    if (t.kind === 'ident') {
      this.next();
      return t.value;
    }
    return null;
  }
  atPunct(ch: string): boolean {
    const t = this.peek();
    return t.kind === 'punct' && t.value === ch;
  }
  expectPunct(ch: string) {
    if (this.atPunct(ch)) this.next();
  }
  stringValue(): string | null {
    const t = this.peek();
    if (t.kind === 'string') {
      this.next();
      return t.value;
    }
    return null;
  }
  numberValue(): number | null {
    const t = this.peek();
    if (t.kind === 'number') {
      this.next();
      return Number.parseInt(t.value, 10);
    }
    return null;
  }
  /** name possibly qualified as schema.name (2 parts) or schema.table.col (3). */
  qualifiedName(): { qualified: string; namespace: string; name: string } | null {
    const first = this.ident();
    if (first === null) return null;
    const parts = [first];
    while (this.atPunct('.')) {
      this.next();
      const seg = this.ident();
      if (seg === null) break;
      parts.push(seg);
    }
    if (parts.length >= 2) {
      // treat first as namespace, rest as name (COMMENT ON COLUMN handles 3-part itself)
      return { qualified: parts.join('.'), namespace: parts[0]!, name: parts.slice(1).join('.') };
    }
    return { qualified: `public.${parts[0]}`, namespace: 'public', name: parts[0]! };
  }
  parenIdentList(): string[] {
    const out: string[] = [];
    if (!this.atPunct('(')) return out;
    this.next();
    while (!this.atPunct(')') && !this.atEof()) {
      if (this.atPunct(',')) {
        this.next();
        continue;
      }
      const id = this.ident();
      if (id) {
        out.push(id);
        // skip ASC/DESC/NULLS etc until comma/paren
        while (!this.atPunct(',') && !this.atPunct(')') && !this.atEof()) this.next();
      } else this.next();
    }
    this.expectPunct(')');
    return out;
  }
  /** Raw text inside the next (...) group, tokens re-joined. */
  parenGroupRaw(): string {
    if (!this.atPunct('(')) return '';
    this.next();
    const parts: string[] = [];
    let depth = 1;
    while (!this.atEof()) {
      if (this.atPunct('(')) depth++;
      else if (this.atPunct(')')) {
        depth--;
        if (depth === 0) {
          this.next();
          break;
        }
      }
      const t = this.next();
      parts.push(t.kind === 'string' ? `'${t.value.replace(/'/g, "''")}'` : t.value);
    }
    return joinTokens(parts);
  }
  skipParens() {
    if (this.atPunct('(')) this.parenGroupRaw();
  }
  restRaw(): string {
    const parts: string[] = [];
    while (!this.atEof()) {
      const t = this.next();
      parts.push(t.kind === 'string' ? `'${t.value.replace(/'/g, "''")}'` : t.value);
    }
    return joinTokens(parts);
  }
  /** Advance to just before the next comma at depth 0 (item boundary in a list). */
  skipToItemBoundary() {
    let depth = 0;
    while (!this.atEof()) {
      if (this.atPunct('(')) depth++;
      else if (this.atPunct(')')) {
        if (depth === 0) return; // the table's closing paren
        depth--;
      } else if (this.atPunct(',') && depth === 0) return;
      this.next();
    }
  }
}
