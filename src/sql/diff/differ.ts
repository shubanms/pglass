// The migration diff engine. diff(from, to, opts) → an ordered, risk-annotated
// set of DiffOps plus ambiguities. See PRD §9.
import { typeStr } from '../../dsl/printer.ts';
import type {
  Column,
  ColumnId,
  EnumType,
  Index,
  Relationship,
  Schema,
  Table,
} from '../../model/types.ts';
import { columnType, ident } from '../export/ddl-writer.ts';
import { analyzeTypeChange } from './type-change.ts';
import {
  type Ambiguity,
  DEFAULT_DIFF_OPTIONS,
  type DiffOp,
  type DiffOptions,
  type DiffResult,
  PHASE,
} from './types.ts';

const DESTRUCTIVE = 'Permanent data loss.';

export function diff(from: Schema, to: Schema, options: Partial<DiffOptions> = {}): DiffResult {
  const opts = { ...DEFAULT_DIFF_OPTIONS, ...options };
  const ctx = new DiffContext(from, to, opts);
  ctx.run();
  return ctx.result();
}

function qtable(t: Table): string {
  return t.namespace === 'public' ? ident(t.name) : `${ident(t.namespace)}.${ident(t.name)}`;
}
function qenum(e: EnumType): string {
  return e.namespace === 'public' ? ident(e.name) : `${ident(e.namespace)}.${ident(e.name)}`;
}
function colName(t: Table, id: ColumnId): string {
  return t.columns.find((c) => c.id === id)?.name ?? '?';
}

class DiffContext {
  private ops: DiffOp[] = [];
  private ambiguities: Ambiguity[] = [];
  private counter = 0;

  constructor(
    private from: Schema,
    private to: Schema,
    private opts: DiffOptions,
  ) {}

  private emit(op: Omit<DiffOp, 'id' | 'dependsOn'> & { dependsOn?: string[] }): DiffOp {
    const full: DiffOp = { id: `op${++this.counter}`, dependsOn: op.dependsOn ?? [], ...op };
    this.ops.push(full);
    return full;
  }

  run() {
    this.diffSchemas();
    this.diffEnums();
    this.diffTables();
  }

  result(): DiffResult {
    // stable order: phase asc, then insertion order
    const ops = [...this.ops].sort(
      (a, b) => a.phase - b.phase || this.ops.indexOf(a) - this.ops.indexOf(b),
    );
    const hasDataLoss = ops.some((o) => o.risk === 'destructive' || o.risk === 'lossy');
    return { ops, ambiguities: this.ambiguities, hasDataLoss };
  }

  // ── namespaces ──
  private diffSchemas() {
    for (const ns of this.to.namespaces) {
      if (ns !== 'public' && !this.from.namespaces.includes(ns)) {
        this.emit({
          kind: 'create_schema',
          sql: `CREATE SCHEMA ${ident(ns)};`,
          risk: 'safe',
          phase: PHASE.create_schema,
        });
      }
    }
    if (this.opts.includeDrops) {
      for (const ns of this.from.namespaces) {
        if (ns !== 'public' && !this.to.namespaces.includes(ns)) {
          this.emit({
            kind: 'drop_schema',
            sql: `DROP SCHEMA ${ident(ns)};`,
            risk: 'destructive',
            warning: DESTRUCTIVE,
            phase: PHASE.drop_table,
          });
        }
      }
    }
  }

  // ── enums ──
  private diffEnums() {
    const matched = matchByKey(
      this.from.enums,
      this.to.enums,
      this.opts.renameStrategy === 'by_id' ? (e) => e.id : (e) => `${e.namespace}.${e.name}`,
    );

    for (const e of matched.added) {
      this.emit({
        kind: 'create_enum',
        sql: `CREATE TYPE ${qenum(e)} AS ENUM (${e.values.map(sqlStr).join(', ')});`,
        risk: 'safe',
        phase: PHASE.create_enum,
      });
    }
    if (this.opts.includeDrops) {
      for (const e of matched.removed) {
        this.emit({
          kind: 'drop_enum',
          sql: `DROP TYPE ${qenum(e)};`,
          risk: 'destructive',
          warning: DESTRUCTIVE,
          phase: PHASE.drop_enum,
        });
      }
    }
    for (const [f, t] of matched.pairs) {
      this.diffEnumValues(f, t);
    }
  }

  private diffEnumValues(from: EnumType, to: EnumType) {
    if (arraysEqual(from.values, to.values)) return;
    const added = to.values.filter((v) => !from.values.includes(v));
    const removed = from.values.filter((v) => !to.values.includes(v));
    // reordered if the shared values appear in a different relative order
    const sharedFrom = from.values.filter((v) => to.values.includes(v));
    const sharedTo = to.values.filter((v) => from.values.includes(v));
    const reordered = !arraysEqual(sharedFrom, sharedTo);

    if (removed.length === 0 && !reordered) {
      // purely additive
      for (const v of added) {
        this.emit({
          kind: 'add_enum_value',
          sql: `ALTER TYPE ${qenum(to)} ADD VALUE ${sqlStr(v)};`,
          risk: 'safe',
          warning: 'Cannot be run inside a transaction block on PG < 12.',
          phase: PHASE.add_enum_value,
        });
      }
      return;
    }

    // ambiguity: additive-only vs recreate the type
    const additiveOps: DiffOp[] = added.map((v) => ({
      id: `amb_add_${v}`,
      kind: 'add_enum_value',
      sql: `ALTER TYPE ${qenum(to)} ADD VALUE ${sqlStr(v)};`,
      risk: 'safe',
      dependsOn: [],
      phase: PHASE.add_enum_value,
    }));

    const recreateOps = this.buildEnumRecreate(to);

    this.ambiguities.push({
      message: `Enum "${to.name}" ${removed.length ? `removed value(s) ${removed.map(sqlStr).join(', ')}` : 'reordered its values'}. Postgres cannot remove or reorder enum values in place.`,
      options: [
        { label: 'A: additive only (leave removed values in place, zero risk)', ops: additiveOps },
        {
          label: 'B: recreate the type (rewrites every column using it — lossy)',
          ops: recreateOps,
        },
      ],
    });
  }

  /** The full rename-recreate-cast-drop dance for an enum (§9.4 option B). */
  private buildEnumRecreate(to: EnumType): DiffOp[] {
    const ops: DiffOp[] = [];
    const oldName = `${to.name}__old`;
    const qOld =
      to.namespace === 'public' ? ident(oldName) : `${ident(to.namespace)}.${ident(oldName)}`;
    let n = 0;
    const mk = (sql: string, risk: DiffOp['risk'], warning?: string): DiffOp => ({
      id: `amb_rec_${to.id}_${++n}`,
      kind: 'create_enum',
      sql,
      risk,
      warning,
      dependsOn: [],
      phase: PHASE.create_enum,
    });

    ops.push(mk(`ALTER TYPE ${qenum(to)} RENAME TO ${ident(oldName)};`, 'safe'));
    ops.push(mk(`CREATE TYPE ${qenum(to)} AS ENUM (${to.values.map(sqlStr).join(', ')});`, 'safe'));

    // every table+column using the enum
    for (const table of this.to.tables) {
      for (const col of table.columns) {
        const usesEnum =
          col.type.udtId === to.id || col.type.name.toLowerCase() === to.name.toLowerCase();
        if (!usesEnum) continue;
        const c = ident(col.name);
        if (col.default !== undefined) {
          ops.push(mk(`ALTER TABLE ${qtable(table)} ALTER COLUMN ${c} DROP DEFAULT;`, 'safe'));
        }
        ops.push(
          mk(
            `ALTER TABLE ${qtable(table)} ALTER COLUMN ${c} TYPE ${qenum(to)} USING ${c}::text::${qenum(to)};`,
            'lossy',
            'Rows holding a removed value will error.',
          ),
        );
        if (col.default !== undefined) {
          ops.push(
            mk(
              `ALTER TABLE ${qtable(table)} ALTER COLUMN ${c} SET DEFAULT ${col.default};`,
              'safe',
            ),
          );
        }
      }
    }

    ops.push(mk(`DROP TYPE ${qOld};`, 'safe'));
    return ops;
  }

  // ── tables ──
  private diffTables() {
    const keyFn =
      this.opts.renameStrategy === 'by_id'
        ? (t: Table) => t.id
        : (t: Table) => `${t.namespace}.${t.name}`;
    const matched = matchByKey(this.from.tables, this.to.tables, keyFn);

    // heuristic rename recovery for unmatched tables
    if (this.opts.renameStrategy === 'heuristic') {
      this.heuristicRename(matched);
    }

    // new tables
    for (const t of matched.added) {
      this.emit({
        kind: 'create_table',
        sql: this.createTableSql(t),
        risk: 'safe',
        phase: PHASE.create_table,
      });
    }

    // dropped tables (last)
    if (this.opts.includeDrops) {
      for (const t of matched.removed) {
        this.emit({
          kind: 'drop_table',
          sql: `DROP TABLE ${qtable(t)};`,
          risk: 'destructive',
          warning: DESTRUCTIVE,
          phase: PHASE.drop_table,
        });
      }
    }

    // matched tables → column/constraint diffs
    for (const [f, t] of matched.pairs) {
      this.diffTable(f, t);
    }

    // relationships (FKs) across the whole schema
    this.diffRelationships(matched);

    // indexes
    this.diffIndexes(matched);

    // comments
    this.diffComments(matched);
  }

  private diffTable(from: Table, to: Table) {
    // rename
    if (from.name !== to.name || from.namespace !== to.namespace) {
      this.emit({
        kind: 'rename_table',
        sql: `ALTER TABLE ${qtable(from)} RENAME TO ${ident(to.name)};`,
        risk: 'safe',
        warning: 'Breaks any application code referencing the old name.',
        phase: PHASE.rename,
      });
    }

    const colKey =
      this.opts.renameStrategy === 'by_id'
        ? (c: Column) => c.id
        : (c: Column) => c.name.toLowerCase();
    const cols = matchByKey(from.columns, to.columns, colKey);

    // added columns
    for (const c of cols.added) {
      const { sql, risk, warning } = this.addColumnSql(to, c);
      this.emit({ kind: 'add_column', sql, risk, warning, phase: PHASE.add_column });
    }

    // matched columns → per-attribute diffs
    for (const [cf, ct] of cols.pairs) {
      this.diffColumn(from, to, cf, ct);
    }

    // dropped columns
    if (this.opts.includeDrops) {
      for (const c of cols.removed) {
        this.emit({
          kind: 'drop_column',
          sql: `ALTER TABLE ${qtable(to)} DROP COLUMN ${ident(c.name)};`,
          risk: 'destructive',
          warning: DESTRUCTIVE,
          phase: PHASE.drop_column,
        });
      }
    }

    // primary key
    this.diffPrimaryKey(from, to);

    // table-level checks
    this.diffChecks(from, to);
  }

  private diffColumn(fromTable: Table, toTable: Table, from: Column, to: Column) {
    // rename (by_id only — same id, different name)
    if (from.name !== to.name) {
      this.emit({
        kind: 'rename_column',
        sql: `ALTER TABLE ${qtable(toTable)} RENAME COLUMN ${ident(from.name)} TO ${ident(to.name)};`,
        risk: 'safe',
        warning: 'Breaks any application code referencing the old name.',
        phase: PHASE.rename,
      });
    }

    const c = ident(to.name);

    // type change (with FK drop/re-add)
    if (typeStr(from.type) !== typeStr(to.type)) {
      const tc = analyzeTypeChange(from.type, to.type, c);
      const using = tc.using ? ` USING ${tc.using}` : '';
      // FKs touching this column must be dropped first and re-added after.
      const affected = this.affectedFks(to.id);
      const dropIds: string[] = [];
      for (const rel of affected) {
        const dropOp = this.emitDropFk(rel, 'from');
        dropIds.push(dropOp.id);
      }
      const alter = this.emit({
        kind: 'alter_column_type',
        sql: `ALTER TABLE ${qtable(toTable)} ALTER COLUMN ${c} TYPE ${columnType(to)}${using};`,
        risk: tc.risk,
        warning: tc.warning,
        dependsOn: dropIds,
        phase: PHASE.alter_type,
      });
      for (const rel of affected) {
        this.emitAddFk(rel, 'to', [alter.id]);
      }
    }

    // NOT NULL change
    if (from.notNull !== to.notNull) {
      if (to.notNull) {
        this.emit({
          kind: 'alter_column_null',
          sql: `ALTER TABLE ${qtable(toTable)} ALTER COLUMN ${c} SET NOT NULL;`,
          risk: 'lock',
          warning:
            'Full table scan to validate. Consider a CHECK ... NOT VALID, validate, then SET NOT NULL.',
          phase: PHASE.alter_null,
        });
      } else {
        this.emit({
          kind: 'alter_column_null',
          sql: `ALTER TABLE ${qtable(toTable)} ALTER COLUMN ${c} DROP NOT NULL;`,
          risk: 'safe',
          phase: PHASE.alter_null,
        });
      }
    }

    // DEFAULT change
    if (from.default !== to.default) {
      if (to.default === undefined) {
        this.emit({
          kind: 'alter_column_default',
          sql: `ALTER TABLE ${qtable(toTable)} ALTER COLUMN ${c} DROP DEFAULT;`,
          risk: 'safe',
          phase: PHASE.alter_default,
        });
      } else {
        this.emit({
          kind: 'alter_column_default',
          sql: `ALTER TABLE ${qtable(toTable)} ALTER COLUMN ${c} SET DEFAULT ${to.default};`,
          risk: 'safe',
          phase: PHASE.alter_default,
        });
      }
    }

    // identity change
    if (from.identity !== to.identity) {
      if (to.identity === 'none') {
        this.emit({
          kind: 'alter_column_identity',
          sql: `ALTER TABLE ${qtable(toTable)} ALTER COLUMN ${c} DROP IDENTITY IF EXISTS;`,
          risk: 'safe',
          phase: PHASE.alter_default,
        });
      } else {
        const kind = to.identity === 'always' ? 'ALWAYS' : 'BY DEFAULT';
        const verb = from.identity === 'none' ? 'ADD' : 'SET';
        const tail =
          from.identity === 'none' ? `ADD GENERATED ${kind} AS IDENTITY` : `SET GENERATED ${kind}`;
        this.emit({
          kind: 'alter_column_identity',
          sql: `ALTER TABLE ${qtable(toTable)} ALTER COLUMN ${c} ${tail};`,
          risk: 'safe',
          phase: PHASE.alter_default,
        });
        void verb;
      }
    }

    // single-column UNIQUE
    if (from.unique !== to.unique) {
      if (to.unique) {
        this.emit({
          kind: 'add_unique',
          sql: `ALTER TABLE ${qtable(toTable)} ADD CONSTRAINT ${ident(`${toTable.name}_${to.name}_key`)} UNIQUE (${c});`,
          risk: 'lock',
          warning: 'Builds a unique index; blocks writes.',
          phase: PHASE.add_pk,
        });
      } else {
        this.emit({
          kind: 'drop_unique',
          sql: `ALTER TABLE ${qtable(toTable)} DROP CONSTRAINT ${ident(`${toTable.name}_${from.name}_key`)};`,
          risk: 'safe',
          phase: PHASE.drop_fk,
        });
      }
    }

    void fromTable;
  }

  private diffPrimaryKey(from: Table, to: Table) {
    const fromNames = from.primaryKey.map((id) => colName(from, id).toLowerCase());
    const toNames = to.primaryKey.map((id) => colName(to, id).toLowerCase());
    if (arraysEqual(fromNames, toNames)) return;

    if (fromNames.length) {
      this.emit({
        kind: 'drop_pk',
        sql: `ALTER TABLE ${qtable(to)} DROP CONSTRAINT ${ident(`${from.name}_pkey`)};`,
        risk: 'safe',
        phase: PHASE.drop_fk,
      });
    }
    if (toNames.length) {
      const cols = to.primaryKey.map((id) => ident(colName(to, id))).join(', ');
      this.emit({
        kind: 'add_pk',
        sql: `ALTER TABLE ${qtable(to)} ADD CONSTRAINT ${ident(`${to.name}_pkey`)} PRIMARY KEY (${cols});`,
        risk: 'lock',
        warning: 'Builds the primary-key index; blocks writes.',
        phase: PHASE.add_pk,
      });
    }
  }

  private diffChecks(from: Table, to: Table) {
    const fromExprs = new Set(from.checks.map((c) => c.expr));
    const toExprs = new Set(to.checks.map((c) => c.expr));
    for (const chk of to.checks) {
      if (!fromExprs.has(chk.expr)) {
        const name = chk.name ? ident(chk.name) : ident(`${to.name}_check`);
        this.emit({
          kind: 'add_check',
          sql: `ALTER TABLE ${qtable(to)} ADD CONSTRAINT ${name} CHECK (${chk.expr});`,
          risk: 'lock',
          warning: 'Scans the table to validate. Consider NOT VALID + VALIDATE CONSTRAINT.',
          phase: PHASE.add_check,
        });
      }
    }
    if (this.opts.includeDrops) {
      for (const chk of from.checks) {
        if (!toExprs.has(chk.expr) && chk.name) {
          this.emit({
            kind: 'drop_check',
            sql: `ALTER TABLE ${qtable(to)} DROP CONSTRAINT ${ident(chk.name)};`,
            risk: 'safe',
            phase: PHASE.drop_fk,
          });
        }
      }
    }
  }

  // ── relationships ──
  private relKey(schema: Schema, rel: Relationship): string {
    const src = schema.tables.find((t) => t.id === rel.sourceTable);
    const tgt = schema.tables.find((t) => t.id === rel.targetTable);
    const sc = rel.sourceColumns.map((id) => (src ? colName(src, id) : id)).join(',');
    const tc = rel.targetColumns.map((id) => (tgt ? colName(tgt, id) : id)).join(',');
    return `${src?.name}(${sc})->${tgt?.name}(${tc})`;
  }

  private fkConstraintName(schema: Schema, rel: Relationship): string {
    const src = schema.tables.find((t) => t.id === rel.sourceTable);
    if (rel.name) return rel.name;
    const cols = rel.sourceColumns.map((id) => (src ? colName(src, id) : id)).join('_');
    return `${src?.name}_${cols}_fkey`;
  }

  private diffRelationships(tableMatch: Match<Table>) {
    void tableMatch;
    const key =
      this.opts.renameStrategy === 'by_id'
        ? (r: Relationship) => r.id
        : (r: Relationship, s: Schema) => this.relKey(s, r);
    const fromKeys = new Map<string, Relationship>();
    for (const r of this.from.relationships) fromKeys.set(key(r, this.from), r);
    const toKeys = new Map<string, Relationship>();
    for (const r of this.to.relationships) toKeys.set(key(r, this.to), r);

    for (const [k, rel] of toKeys) {
      const prev = fromKeys.get(k);
      if (!prev) {
        this.emitAddFk(rel, 'to', []);
      } else if (prev.onDelete !== rel.onDelete || prev.onUpdate !== rel.onUpdate) {
        const drop = this.emitDropFk(prev, 'from');
        this.emitAddFk(rel, 'to', [drop.id]);
      }
    }
    if (this.opts.includeDrops) {
      for (const [k, rel] of fromKeys) {
        if (!toKeys.has(k)) this.emitDropFk(rel, 'from');
      }
    }
  }

  /** FKs in the *from* schema whose source or target columns include `columnId`. */
  private affectedFks(columnId: ColumnId): Relationship[] {
    return this.from.relationships.filter(
      (r) => r.sourceColumns.includes(columnId) || r.targetColumns.includes(columnId),
    );
  }

  private emitDropFk(rel: Relationship, side: 'from' | 'to'): DiffOp {
    const schema = side === 'from' ? this.from : this.to;
    const src = schema.tables.find((t) => t.id === rel.sourceTable)!;
    return this.emit({
      kind: 'drop_fk',
      sql: `ALTER TABLE ${qtable(src)} DROP CONSTRAINT ${ident(this.fkConstraintName(schema, rel))};`,
      risk: 'safe',
      phase: PHASE.drop_fk,
    });
  }

  private emitAddFk(rel: Relationship, side: 'from' | 'to', dependsOn: string[]): DiffOp {
    const schema = side === 'from' ? this.from : this.to;
    const src = schema.tables.find((t) => t.id === rel.sourceTable)!;
    const tgt = schema.tables.find((t) => t.id === rel.targetTable)!;
    const sc = rel.sourceColumns.map((id) => ident(colName(src, id))).join(', ');
    const tc = rel.targetColumns.map((id) => ident(colName(tgt, id))).join(', ');
    let sql = `ALTER TABLE ${qtable(src)} ADD CONSTRAINT ${ident(this.fkConstraintName(schema, rel))} FOREIGN KEY (${sc}) REFERENCES ${qtable(tgt)} (${tc})`;
    if (rel.onDelete !== 'no_action') sql += ` ON DELETE ${refAction(rel.onDelete)}`;
    if (rel.onUpdate !== 'no_action') sql += ` ON UPDATE ${refAction(rel.onUpdate)}`;
    sql += ';';
    return this.emit({
      kind: 'add_fk',
      sql,
      risk: 'lock',
      warning: 'Scans both tables. Consider NOT VALID + VALIDATE CONSTRAINT.',
      dependsOn,
      phase: PHASE.add_fk,
    });
  }

  // ── indexes ──
  private diffIndexes(tableMatch: Match<Table>) {
    void tableMatch;
    const key =
      this.opts.renameStrategy === 'by_id'
        ? (ix: Index) => ix.id
        : (ix: Index, s: Schema) => this.indexKey(s, ix);
    const fromKeys = new Map<string, Index>();
    for (const ix of this.from.indexes) fromKeys.set(key(ix, this.from), ix);
    const toKeys = new Map<string, Index>();
    for (const ix of this.to.indexes) toKeys.set(key(ix, this.to), ix);

    for (const [k, ix] of toKeys) {
      const prev = fromKeys.get(k);
      if (!prev || this.indexKey(this.from, prev) !== this.indexKey(this.to, ix)) {
        if (prev && this.opts.includeDrops) this.emitDropIndex(prev);
        this.emitCreateIndex(ix);
      }
    }
    if (this.opts.includeDrops) {
      for (const [k, ix] of fromKeys) {
        if (!toKeys.has(k)) this.emitDropIndex(ix);
      }
    }
  }

  private indexKey(schema: Schema, ix: Index): string {
    const table = schema.tables.find((t) => t.id === ix.table);
    const keys = ix.keys
      .map((k) => (k.kind === 'column' ? colName(table!, k.column) : k.expr))
      .join(',');
    return `${table?.name}|${ix.unique}|${ix.method}|${keys}|${ix.where ?? ''}`;
  }

  private emitCreateIndex(ix: Index) {
    const table = this.to.tables.find((t) => t.id === ix.table);
    if (!table) return;
    const concurrent = this.opts.concurrentIndexes ? 'CONCURRENTLY ' : '';
    const keys = ix.keys
      .map((k) => {
        if (k.kind === 'expr') return `(${k.expr})`;
        let s = ident(colName(table, k.column));
        if (k.sort) s += ` ${k.sort.toUpperCase()}`;
        if (k.nulls) s += ` NULLS ${k.nulls.toUpperCase()}`;
        return s;
      })
      .join(', ');
    const method = ix.method !== 'btree' ? ` USING ${ix.method}` : '';
    const name = ix.name ?? `${table.name}_idx`;
    let sql = `CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX ${concurrent}${ident(name)} ON ${qtable(table)}${method} (${keys})`;
    if (ix.where) sql += ` WHERE ${ix.where}`;
    sql += ';';
    this.emit({
      kind: 'create_index',
      sql,
      risk: this.opts.concurrentIndexes ? 'safe' : 'lock',
      warning: this.opts.concurrentIndexes
        ? 'Cannot run inside a transaction block.'
        : 'Blocks writes. Use CONCURRENTLY in production.',
      phase: PHASE.create_index,
    });
  }

  private emitDropIndex(ix: Index) {
    const table = this.from.tables.find((t) => t.id === ix.table);
    const name = ix.name ?? `${table?.name}_idx`;
    this.emit({
      kind: 'drop_index',
      sql: `DROP INDEX ${ident(name)};`,
      risk: 'safe',
      phase: PHASE.drop_index,
    });
  }

  // ── comments ──
  private diffComments(tableMatch: Match<Table>) {
    for (const [f, t] of tableMatch.pairs) {
      if (f.comment !== t.comment && t.comment !== undefined) {
        this.emit({
          kind: 'set_comment',
          sql: `COMMENT ON TABLE ${qtable(t)} IS ${sqlStr(t.comment)};`,
          risk: 'safe',
          phase: PHASE.comment,
        });
      }
    }
  }

  // ── heuristic rename recovery (§9.5) ──
  private heuristicRename(matched: Match<Table>) {
    const added = [...matched.added];
    const removed = [...matched.removed];
    for (let i = added.length - 1; i >= 0; i--) {
      const nt = added[i]!;
      let best = -1;
      let bestScore = 0;
      let runnerUp = 0;
      for (let j = 0; j < removed.length; j++) {
        const s = tableSimilarity(removed[j]!, nt);
        if (s > bestScore) {
          runnerUp = bestScore;
          bestScore = s;
          best = j;
        } else if (s > runnerUp) runnerUp = s;
      }
      if (best >= 0 && bestScore > 0.7 && runnerUp < 0.5) {
        matched.pairs.push([removed[best]!, nt]);
        added.splice(i, 1);
        removed.splice(best, 1);
      }
    }
    matched.added = added;
    matched.removed = removed;
  }

  // ── sql builders ──
  private createTableSql(t: Table): string {
    const inner = t.columns.map(
      (c) => `  ${ident(c.name)} ${columnType(c)}${c.notNull ? ' NOT NULL' : ''}`,
    );
    if (t.primaryKey.length) {
      inner.push(`  PRIMARY KEY (${t.primaryKey.map((id) => ident(colName(t, id))).join(', ')})`);
    }
    return `CREATE TABLE ${qtable(t)} (\n${inner.join(',\n')}\n);`;
  }

  private addColumnSql(
    t: Table,
    c: Column,
  ): { sql: string; risk: DiffOp['risk']; warning?: string } {
    let sql = `ALTER TABLE ${qtable(t)} ADD COLUMN ${ident(c.name)} ${columnType(c)}`;
    if (c.default !== undefined) sql += ` DEFAULT ${c.default}`;
    if (c.notNull) sql += ' NOT NULL';
    sql += ';';
    let risk: DiffOp['risk'] = 'safe';
    let warning: string | undefined;
    if (c.notNull && c.default === undefined) {
      risk = 'destructive';
      warning = 'Fails if the table has any rows.';
    } else if (c.notNull && c.default !== undefined && isVolatileDefault(c.default)) {
      risk = 'lock';
      warning =
        'Rewrites the whole table. Use a nullable column + backfill + SET NOT NULL instead.';
    }
    return { sql, risk, warning };
  }
}

// ── generic matching ──
interface Match<T> {
  pairs: [T, T][];
  added: T[]; // in `to` only
  removed: T[]; // in `from` only
}

function matchByKey<T>(from: T[], to: T[], key: (x: T) => string): Match<T> {
  const fromMap = new Map<string, T>();
  for (const x of from) fromMap.set(key(x), x);
  const toMap = new Map<string, T>();
  for (const x of to) toMap.set(key(x), x);

  const pairs: [T, T][] = [];
  const added: T[] = [];
  const removed: T[] = [];
  for (const x of to) {
    const f = fromMap.get(key(x));
    if (f) pairs.push([f, x]);
    else added.push(x);
  }
  for (const x of from) {
    if (!toMap.has(key(x))) removed.push(x);
  }
  return { pairs, added, removed };
}

function tableSimilarity(a: Table, b: Table): number {
  const an = new Set(a.columns.map((c) => c.name.toLowerCase()));
  const bn = new Set(b.columns.map((c) => c.name.toLowerCase()));
  let shared = 0;
  for (const x of an) if (bn.has(x)) shared++;
  const union = an.size + bn.size - shared;
  const jaccard = union === 0 ? 0 : shared / union;

  const at = a.columns.map((c) => c.type.name).join(',');
  const bt = b.columns.map((c) => c.type.name).join(',');
  const typeSim = at === bt ? 1 : 0;
  return jaccard * 0.7 + typeSim * 0.3;
}

function refAction(a: string): string {
  return (
    {
      cascade: 'CASCADE',
      restrict: 'RESTRICT',
      set_null: 'SET NULL',
      set_default: 'SET DEFAULT',
      no_action: 'NO ACTION',
    }[a] ?? 'NO ACTION'
  );
}

function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function isVolatileDefault(def: string): boolean {
  // constants and simple literals don't rewrite; function calls may.
  return /\b(now|current_timestamp|gen_random_uuid|uuid_generate|nextval|random|clock_timestamp)\b/i.test(
    def,
  );
}
