import { describe, expect, it } from 'vitest';
import { newColumnId, newRelId, newTableId } from '../ids.ts';
import { emptySchema } from '../schema.ts';
import type { Column, Relationship, Schema, Table } from '../types.ts';
import { SchemaCorruptionError, validate } from '../validate.ts';

function col(name: string, typeName = 'integer'): Column {
  return {
    id: newColumnId(),
    name,
    type: { name: typeName, args: [], arrayDims: 0 },
    notNull: false,
    unique: false,
    identity: 'none',
    generated: { kind: 'none' },
  };
}

function table(name: string, columns: Column[]): Table {
  return {
    id: newTableId(),
    namespace: 'public',
    name,
    columns,
    primaryKey: [],
    checks: [],
    pos: { x: 0, y: 0 },
  };
}

describe('validate — structural corruption throws', () => {
  it('throws on duplicate column names (invariant 4)', () => {
    const c = col('a');
    const dup = { ...col('A'), id: newColumnId() }; // case-insensitive clash
    const s: Schema = { ...emptySchema(), tables: [table('t', [c, dup])] };
    expect(() => validate(s)).toThrow(SchemaCorruptionError);
  });

  it('throws on duplicate table names in a namespace (invariant 5)', () => {
    const s: Schema = {
      ...emptySchema(),
      tables: [table('t', [col('a')]), table('T', [col('b')])],
    };
    expect(() => validate(s)).toThrow(SchemaCorruptionError);
  });

  it('throws on a PK column that does not belong to the table (invariant 6)', () => {
    const t = table('t', [col('a')]);
    t.primaryKey = [newColumnId()];
    const s: Schema = { ...emptySchema(), tables: [t] };
    expect(() => validate(s)).toThrow(SchemaCorruptionError);
  });
});

describe('validate — soft invariants become diagnostics', () => {
  it('PGL201 when FK target columns are not unique/PK', () => {
    const targetCol = col('id');
    const target = table('users', [targetCol]);
    // no PK, not unique → invalid target
    const srcCol = col('user_id');
    const source = table('orders', [srcCol]);
    const rel: Relationship = {
      id: newRelId(),
      sourceTable: source.id,
      sourceColumns: [srcCol.id],
      targetTable: target.id,
      targetColumns: [targetCol.id],
      onDelete: 'no_action',
      onUpdate: 'no_action',
    };
    const s: Schema = { ...emptySchema(), tables: [target, source], relationships: [rel] };
    const diags = validate(s);
    expect(diags.some((d) => d.code === 'PGL201')).toBe(true);
  });

  it('accepts an FK whose target is the PK', () => {
    const targetCol = col('id');
    const target = table('users', [targetCol]);
    target.primaryKey = [targetCol.id];
    const srcCol = col('user_id');
    const source = table('orders', [srcCol]);
    const rel: Relationship = {
      id: newRelId(),
      sourceTable: source.id,
      sourceColumns: [srcCol.id],
      targetTable: target.id,
      targetColumns: [targetCol.id],
      onDelete: 'no_action',
      onUpdate: 'no_action',
    };
    const s: Schema = { ...emptySchema(), tables: [target, source], relationships: [rel] };
    expect(validate(s).filter((d) => d.code === 'PGL201')).toEqual([]);
  });
});
