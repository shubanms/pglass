import { describe, expect, it } from 'vitest';
import { parse } from '../../../dsl/parser.ts';
import type { Schema } from '../../../model/types.ts';
import { diff } from '../differ.ts';
import { renderDiff } from '../render.ts';
import type { DiffKind } from '../types.ts';

/** Parse two .pgl docs and preserve stable ids by re-using the first parse's
 *  schema as the base for edits (so renameStrategy 'by_id' works). */
function pglDiff(fromSrc: string, mutate: (s: Schema) => Schema, opts = {}) {
  const from = parse(fromSrc).schema;
  const to = mutate(structuredClone(from));
  return diff(from, to, opts);
}

const kinds = (ops: { kind: DiffKind }[]) => ops.map((o) => o.kind);

describe('diff engine — basic ops', () => {
  it('adds a new table as CREATE TABLE', () => {
    const from = parse('table users {\n  id bigint [pk]\n}\n').schema;
    const to = structuredClone(from);
    to.tables.push({
      ...from.tables[0]!,
      id: 't_new' as never,
      name: 'orders',
      columns: from.tables[0]!.columns.map((c) => ({ ...c, id: `${c.id}x` as never })),
      primaryKey: from.tables[0]!.columns.map((c) => `${c.id}x` as never),
    });
    const r = diff(from, to);
    expect(kinds(r.ops)).toContain('create_table');
  });

  it('drops a removed table last (phase 18) and flags data loss', () => {
    const from = parse('table a {\n  id bigint [pk]\n}\n\ntable b {\n  id bigint [pk]\n}\n').schema;
    const to = structuredClone(from);
    to.tables = to.tables.filter((t) => t.name === 'a');
    const r = diff(from, to);
    expect(kinds(r.ops)).toContain('drop_table');
    expect(r.hasDataLoss).toBe(true);
    const dropOp = r.ops.find((o) => o.kind === 'drop_table')!;
    expect(dropOp.risk).toBe('destructive');
  });

  it('detects a table rename by id (not drop+create)', () => {
    const r = pglDiff('table users {\n  id bigint [pk]\n}\n', (s) => {
      s.tables[0]!.name = 'members';
      return s;
    });
    expect(kinds(r.ops)).toContain('rename_table');
    expect(kinds(r.ops)).not.toContain('drop_table');
    expect(kinds(r.ops)).not.toContain('create_table');
  });
});

describe('diff engine — the nasty cases (§17)', () => {
  it('FK-blocked type change: emits drop-FK → alter type → re-add FK, in order', () => {
    const src = `table users {\n  id bigint [pk]\n}\n\ntable orders {\n  id bigint [pk]\n  user_id bigint [not null, ref: > users.id]\n}\n`;
    const r = pglDiff(src, (s) => {
      const orders = s.tables.find((t) => t.name === 'orders')!;
      const uid = orders.columns.find((c) => c.name === 'user_id')!;
      // widen the FK-participating id + user_id to keep them consistent
      uid.type = { name: 'bigint', args: [], arrayDims: 0 };
      // change users.id type → forces FK drop/re-add
      const users = s.tables.find((t) => t.name === 'users')!;
      users.columns.find((c) => c.name === 'id')!.type = {
        name: 'integer',
        args: [],
        arrayDims: 0,
      };
      return s;
    });
    const k = kinds(r.ops);
    expect(k).toContain('drop_fk');
    expect(k).toContain('alter_column_type');
    expect(k).toContain('add_fk');
    // ordering: drop_fk (phase 4) before alter (9) before add_fk (15)
    const dropIdx = r.ops.findIndex((o) => o.kind === 'drop_fk');
    const alterIdx = r.ops.findIndex((o) => o.kind === 'alter_column_type');
    const addIdx = r.ops.findIndex((o) => o.kind === 'add_fk');
    expect(dropIdx).toBeLessThan(alterIdx);
    expect(alterIdx).toBeLessThan(addIdx);
    // the alter depends on the drop, the re-add depends on the alter
    const alterOp = r.ops[alterIdx]!;
    const addOp = r.ops[addIdx]!;
    expect(alterOp.dependsOn).toContain(r.ops[dropIdx]!.id);
    expect(addOp.dependsOn).toContain(alterOp.id);
  });

  it('widening int→bigint is a lock with a rewrite warning', () => {
    const r = pglDiff('table t {\n  n integer\n}\n', (s) => {
      s.tables[0]!.columns[0]!.type = { name: 'bigint', args: [], arrayDims: 0 };
      return s;
    });
    const op = r.ops.find((o) => o.kind === 'alter_column_type')!;
    expect(op.risk).toBe('lock');
    expect(op.sql).toContain('TYPE bigint');
    expect(op.sql).not.toContain('USING'); // no USING needed for int→bigint
  });

  it('narrowing bigint→integer is lossy with a USING cast', () => {
    const r = pglDiff('table t {\n  n bigint\n}\n', (s) => {
      s.tables[0]!.columns[0]!.type = { name: 'integer', args: [], arrayDims: 0 };
      return s;
    });
    const op = r.ops.find((o) => o.kind === 'alter_column_type')!;
    expect(op.risk).toBe('lossy');
    expect(op.sql).toContain('USING n::integer');
  });

  it('enum value removal produces an ambiguity with additive + recreate options', () => {
    const src = `enum status {\n  a\n  b\n  c\n}\n\ntable t {\n  s status [default: 'a']\n}\n`;
    const r = pglDiff(src, (s) => {
      s.enums[0]!.values = ['a', 'b']; // dropped 'c'
      return s;
    });
    expect(r.ambiguities).toHaveLength(1);
    const [a, b] = r.ambiguities[0]!.options;
    expect(a!.label).toMatch(/additive/i);
    expect(b!.label).toMatch(/recreate/i);
    // option B must touch the column using the enum, with the cast dance
    const bSql = b!.ops.map((o) => o.sql).join('\n');
    expect(bSql).toContain('RENAME TO status__old');
    expect(bSql).toContain('CREATE TYPE status AS ENUM');
    expect(bSql).toContain('USING s::text::status');
    expect(bSql).toContain('DROP DEFAULT');
    expect(bSql).toContain('SET DEFAULT');
    expect(bSql).toContain('DROP TYPE status__old');
  });

  it('purely additive enum change just emits ADD VALUE (no ambiguity)', () => {
    const r = pglDiff('enum status {\n  a\n  b\n}\n', (s) => {
      s.enums[0]!.values = ['a', 'b', 'c'];
      return s;
    });
    expect(r.ambiguities).toHaveLength(0);
    const op = r.ops.find((o) => o.kind === 'add_enum_value')!;
    expect(op.sql).toContain("ADD VALUE 'c'");
    expect(op.risk).toBe('safe');
  });

  it('PK change drops then adds the primary key constraint', () => {
    const src = `table t {\n  a bigint [pk]\n  b bigint\n}\n`;
    const r = pglDiff(src, (s) => {
      const t = s.tables[0]!;
      t.primaryKey = [t.columns.find((c) => c.name === 'b')!.id];
      return s;
    });
    const k = kinds(r.ops);
    expect(k).toContain('drop_pk');
    expect(k).toContain('add_pk');
    expect(r.ops.findIndex((o) => o.kind === 'drop_pk')).toBeLessThan(
      r.ops.findIndex((o) => o.kind === 'add_pk'),
    );
  });

  it('dropping a column is destructive', () => {
    const r = pglDiff('table t {\n  id bigint [pk]\n  gone text\n}\n', (s) => {
      s.tables[0]!.columns = s.tables[0]!.columns.filter((c) => c.name !== 'gone');
      return s;
    });
    const op = r.ops.find((o) => o.kind === 'drop_column')!;
    expect(op.risk).toBe('destructive');
    expect(r.hasDataLoss).toBe(true);
  });

  it('ADD COLUMN NOT NULL without default is destructive', () => {
    const r = pglDiff('table t {\n  id bigint [pk]\n}\n', (s) => {
      s.tables[0]!.columns.push({
        id: 'c_new' as never,
        name: 'req',
        type: { name: 'text', args: [], arrayDims: 0 },
        notNull: true,
        unique: false,
        identity: 'none',
        generated: { kind: 'none' },
      });
      return s;
    });
    const op = r.ops.find((o) => o.kind === 'add_column')!;
    expect(op.risk).toBe('destructive');
  });
});

describe('diff engine — render', () => {
  it('renders warnings as -- comments and wraps in a transaction', () => {
    const r = pglDiff('table t {\n  n integer\n}\n', (s) => {
      s.tables[0]!.columns[0]!.type = { name: 'bigint', args: [], arrayDims: 0 };
      return s;
    });
    const sql = renderDiff(r, { transactional: true });
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toMatch(/-- \[lock\]/);
  });

  it('reports no changes for identical schemas', () => {
    const s = parse('table t {\n  id bigint [pk]\n}\n').schema;
    const r = diff(s, structuredClone(s));
    expect(r.ops).toHaveLength(0);
    expect(renderDiff(r)).toContain('No changes');
  });
});
