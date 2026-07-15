import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser.ts';
import type { Schema, TableId } from '../../model/types.ts';
import { mergeSchema } from '../merge.ts';

function withPos(schema: Schema, name: string, x: number, y: number): Schema {
  return {
    ...schema,
    tables: schema.tables.map((t) => (t.name === name ? { ...t, pos: { x, y } } : t)),
  };
}

describe('mergeSchema — identity reconciliation (§8)', () => {
  it('keeps table id, position and colour when only the type of a column changes', () => {
    const prev0 = parse('table users {\n  id bigint [pk]\n  age integer\n}\n').schema;
    const prev = withPos(prev0, 'users', 500, 300);
    const users = prev.tables.find((t) => t.name === 'users')!;
    users.color = '#abcdef';

    const next = parse('table users {\n  id bigint [pk]\n  age bigint\n}\n').schema;
    const merged = mergeSchema(prev, next);

    const mt = merged.tables.find((t) => t.name === 'users')!;
    expect(mt.id).toBe(users.id); // stable id
    expect(mt.pos).toEqual({ x: 500, y: 300 }); // position preserved
    expect(mt.color).toBe('#abcdef'); // colour preserved
    expect(mt.columns.find((c) => c.name === 'age')?.type.name).toBe('bigint'); // structure from next
    // the id column keeps its identity so relationships/selection survive
    expect(mt.columns.find((c) => c.name === 'id')?.id).toBe(
      users.columns.find((c) => c.name === 'id')?.id,
    );
  });

  it('treats a table rename as non-destructive (keeps id + position)', () => {
    const prev = withPos(
      parse('table users {\n  id bigint [pk]\n  email text\n  name text\n}\n').schema,
      'users',
      120,
      240,
    );
    const oldId = prev.tables[0]!.id;

    const next = parse('table members {\n  id bigint [pk]\n  email text\n  name text\n}\n').schema;
    const merged = mergeSchema(prev, next);

    expect(merged.tables).toHaveLength(1);
    const mt = merged.tables[0]!;
    expect(mt.name).toBe('members');
    expect(mt.id).toBe(oldId); // rename detected → id preserved
    expect(mt.pos).toEqual({ x: 120, y: 240 });
  });

  it('does NOT treat unrelated tables as a rename (low overlap)', () => {
    const prev = parse('table users {\n  id bigint [pk]\n  email text\n}\n').schema;
    const next = parse('table invoices {\n  amount integer\n  due_on date\n}\n').schema;
    const merged = mergeSchema(prev, next);
    // no shared column names → drop + create, fresh id
    expect(merged.tables[0]!.name).toBe('invoices');
    expect(merged.tables[0]!.id).not.toBe(prev.tables[0]!.id);
  });

  it('auto-places genuinely new tables away from the origin', () => {
    const prev = withPos(parse('table a {\n  id bigint [pk]\n}\n').schema, 'a', 0, 0);
    const next = parse('table a {\n  id bigint [pk]\n}\n\ntable b {\n  id bigint [pk]\n}\n').schema;
    const merged = mergeSchema(prev, next);
    const b = merged.tables.find((t) => t.name === 'b')!;
    expect(b.pos.x).toBeGreaterThan(0); // not stacked at (0,0)
  });

  it('remaps relationship endpoints to carried table ids', () => {
    const src =
      'table users {\n  id bigint [pk]\n}\n\ntable orders {\n  id bigint [pk]\n  user_id bigint [ref: > users.id]\n}\n';
    const prev = parse(src).schema;
    const next = parse(src).schema; // re-parse → fresh ids
    const merged = mergeSchema(prev, next);

    const rel = merged.relationships[0]!;
    const carriedIds = new Set(merged.tables.map((t) => t.id));
    expect(carriedIds.has(rel.sourceTable as TableId)).toBe(true);
    expect(carriedIds.has(rel.targetTable as TableId)).toBe(true);
    // endpoints point at the PREV ids (carried), proving reconciliation
    const prevIds = new Set(prev.tables.map((t) => t.id));
    expect(prevIds.has(rel.sourceTable as TableId)).toBe(true);
  });

  it('reattaches relationship waypoints across a re-parse', () => {
    const src =
      'table users {\n  id bigint [pk]\n}\n\ntable orders {\n  id bigint [pk]\n  user_id bigint [ref: > users.id]\n}\n';
    const prev = parse(src).schema;
    prev.relationships[0]!.waypoints = [{ x: 10, y: 20 }];

    const next = parse(src).schema;
    const merged = mergeSchema(prev, next);
    expect(merged.relationships[0]!.waypoints).toEqual([{ x: 10, y: 20 }]);
  });
});
