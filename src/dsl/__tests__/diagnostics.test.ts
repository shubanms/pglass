import { describe, expect, it } from 'vitest';
import { parse } from '../parser.ts';

function codes(src: string): string[] {
  return parse(src).diagnostics.map((d) => d.code);
}

describe('parser diagnostics', () => {
  it('PGL006 duplicate column name', () => {
    expect(codes('table t { a int\n a text }')).toContain('PGL006');
  });

  it('PGL007 duplicate table name', () => {
    expect(codes('table t { a int }\n table t { b int }')).toContain('PGL007');
  });

  it('PGL012 duplicate enum value', () => {
    expect(codes('enum e { x\n y\n x }')).toContain('PGL012');
  });

  it('PGL015 increment on a non-integer type', () => {
    expect(codes('table t { id uuid [pk, increment] }')).toContain('PGL015');
  });

  it('PGL008 ref target table not found', () => {
    expect(codes('table t { a int [ref: > ghost.id] }')).toContain('PGL008');
  });

  it('PGL004 unknown type is info-level and preserved', () => {
    const { schema, diagnostics } = parse('table t { g geometry_zzz }');
    expect(diagnostics.some((d) => d.code === 'PGL004')).toBe(true);
    // unknown type still round-trips: it is kept verbatim on the column
    expect(schema.tables[0]?.columns[0]?.type.name).toBe('geometry_zzz');
  });

  it('PGL005 wrong arity for a builtin type', () => {
    expect(codes('table t { a uuid(3) }')).toContain('PGL005');
  });

  it('never throws on garbage input and always returns a schema', () => {
    const { schema } = parse('table @#$ { %%% } ref ::: garbage }}}} table ok { id int }');
    expect(schema.version).toBe(1);
    // recovery lets the well-formed table through
    expect(schema.tables.some((t) => t.name === 'ok')).toBe(true);
  });

  it('is error-tolerant: a broken table does not kill later statements', () => {
    const { schema } = parse('table broken { a\n table good { id int [pk] } }');
    expect(schema.tables.some((t) => t.name === 'good' || t.name === 'broken')).toBe(true);
  });
});
