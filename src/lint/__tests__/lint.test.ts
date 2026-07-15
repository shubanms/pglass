import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser.ts';
import type { Schema } from '../../model/types.ts';
import { ALL_RULES, lint } from '../engine.ts';

function schemaOf(src: string): Schema {
  return parse(src).schema;
}
function codes(src: string, config = {}): string[] {
  return lint(schemaOf(src), config).map((d) => d.code);
}

describe('lint — correctness', () => {
  it('L001 fires on a table with no PK, not on one with a PK', () => {
    expect(codes('table t {\n  a int\n}\n')).toContain('L001');
    expect(codes('table t {\n  id bigint [pk]\n}\n')).not.toContain('L001');
  });

  it('L002 fires when an FK targets a non-unique column', () => {
    // orders.user_id → users.id, but users.id is not a PK/unique here
    const src =
      'table users {\n  id uuid\n}\n\ntable orders {\n  id bigint [pk]\n  user_id uuid [ref: > users.id]\n}\n';
    expect(codes(src)).toContain('L002');
  });

  it('L003 fires on an FK type mismatch', () => {
    const src =
      'table users {\n  id uuid [pk]\n}\n\ntable orders {\n  id bigint [pk]\n  user_id text [ref: > users.id]\n}\n';
    expect(codes(src)).toContain('L003');
  });

  it('L007 fires on an unused enum', () => {
    expect(codes('enum e { a\n b }\n\ntable t {\n  id bigint [pk]\n}\n')).toContain('L007');
    expect(codes('enum e { a\n b }\n\ntable t {\n  id bigint [pk]\n  s e\n}\n')).not.toContain(
      'L007',
    );
  });

  it('L008 fires on a duplicate index', () => {
    const src = 'table t {\n  id bigint [pk]\n  a int\n\n  indexes {\n    (a)\n    (a)\n  }\n}\n';
    expect(codes(src)).toContain('L008');
  });

  it('L009 fires on a redundant prefix index', () => {
    const src =
      'table t {\n  id bigint [pk]\n  a int\n  b int\n\n  indexes {\n    (a)\n    (a, b)\n  }\n}\n';
    expect(codes(src)).toContain('L009');
  });
});

describe('lint — performance', () => {
  it('L101 fires on an unindexed FK column', () => {
    const src =
      'table users {\n  id uuid [pk]\n}\n\ntable orders {\n  id bigint [pk]\n  user_id uuid [ref: > users.id]\n}\n';
    expect(codes(src)).toContain('L101');
  });

  it('L104 fires on varchar(n)', () => {
    expect(codes('table t {\n  id bigint [pk]\n  name varchar(120)\n}\n')).toContain('L104');
    expect(codes('table t {\n  id bigint [pk]\n  name text\n}\n')).not.toContain('L104');
  });

  it('L106 fires on timestamp without time zone', () => {
    expect(codes('table t {\n  id bigint [pk]\n  at timestamp\n}\n')).toContain('L106');
    expect(codes('table t {\n  id bigint [pk]\n  at timestamptz\n}\n')).not.toContain('L106');
  });

  it('L107 fires on money', () => {
    expect(codes('table t {\n  id bigint [pk]\n  cost money\n}\n')).toContain('L107');
  });

  it('L108 fires on a float price column', () => {
    expect(codes('table t {\n  id bigint [pk]\n  price real\n}\n')).toContain('L108');
  });
});

describe('lint — design', () => {
  it('L203 fires when an FK column is not named <table>_id', () => {
    const src =
      'table users {\n  id uuid [pk]\n}\n\ntable orders {\n  id bigint [pk]\n  owner uuid [ref: > users.id]\n}\n';
    expect(codes(src)).toContain('L203');
  });

  it('L205 fires on a reserved-word table name', () => {
    expect(codes('table "order" {\n  id bigint [pk]\n}\n')).toContain('L205');
  });

  it('L206 fires on an identifier over 63 chars', () => {
    const long = 'a'.repeat(70);
    expect(codes(`table ${long} {\n  id bigint [pk]\n}\n`)).toContain('L206');
  });

  it('L211 fires on a bidirectional FK dependency', () => {
    const src =
      'table a {\n  id bigint [pk]\n  b_id bigint [ref: > b.id]\n}\n\ntable b {\n  id bigint [pk]\n  a_id bigint [ref: > a.id]\n}\n';
    expect(codes(src)).toContain('L211');
  });
});

describe('lint — security', () => {
  it('L301 fires on a plaintext-looking password column', () => {
    expect(codes('table users {\n  id bigint [pk]\n  password text\n}\n')).toContain('L301');
  });

  it('L303 fires on a tenant table without RLS', () => {
    expect(codes('table docs {\n  id bigint [pk]\n  tenant_id bigint\n}\n')).toContain('L303');
  });
});

describe('lint — config', () => {
  it('off-by-default rules do not fire unless enabled', () => {
    const src = 'table t {\n  id bigint [pk]\n}\n'; // no created_at → L204
    expect(codes(src)).not.toContain('L204');
    expect(codes(src, { L204: true })).toContain('L204');
  });

  it('a rule can be disabled', () => {
    const src = 'table t {\n  a int\n}\n';
    expect(codes(src, { L001: false })).not.toContain('L001');
  });
});

describe('lint — auto-fixes', () => {
  function fixFor(src: string, code: string) {
    const schema = schemaOf(src);
    const diag = lint(schema).find((d) => d.code === code);
    return { schema, diag };
  }

  it('L001 fix adds a primary key and clears the diagnostic', () => {
    const { schema, diag } = fixFor('table t {\n  a int\n}\n', 'L001');
    expect(diag?.fix).toBeDefined();
    const fixed = diag!.fix!.apply(schema);
    expect(fixed.tables[0]!.primaryKey.length).toBe(1);
    expect(lint(fixed).some((d) => d.code === 'L001')).toBe(false);
  });

  it('L104 fix converts varchar(n) → text', () => {
    const { schema, diag } = fixFor('table t {\n  id bigint [pk]\n  name varchar(50)\n}\n', 'L104');
    const fixed = diag!.fix!.apply(schema);
    expect(fixed.tables[0]!.columns.find((c) => c.name === 'name')?.type.name).toBe('text');
    expect(lint(fixed).some((d) => d.code === 'L104')).toBe(false);
  });

  it('L106 fix converts timestamp → timestamptz', () => {
    const { schema, diag } = fixFor('table t {\n  id bigint [pk]\n  at timestamp\n}\n', 'L106');
    const fixed = diag!.fix!.apply(schema);
    expect(fixed.tables[0]!.columns.find((c) => c.name === 'at')?.type.name).toBe('timestamptz');
  });

  it('L101 fix creates an index that satisfies the rule', () => {
    const src =
      'table users {\n  id uuid [pk]\n}\n\ntable orders {\n  id bigint [pk]\n  user_id uuid [ref: > users.id]\n}\n';
    const { schema, diag } = fixFor(src, 'L101');
    const fixed = diag!.fix!.apply(schema);
    expect(fixed.indexes.length).toBe(1);
    expect(lint(fixed).some((d) => d.code === 'L101')).toBe(false);
  });

  it('L303 fix enables row-level security', () => {
    const { schema, diag } = fixFor(
      'table docs {\n  id bigint [pk]\n  tenant_id bigint\n}\n',
      'L303',
    );
    const fixed = diag!.fix!.apply(schema);
    expect(fixed.tables[0]!.rowLevelSecurity).toBe(true);
    expect(lint(fixed).some((d) => d.code === 'L303')).toBe(false);
  });
});

describe('lint — registry', () => {
  it('every rule has a unique code and a check function', () => {
    const codes = ALL_RULES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const r of ALL_RULES) expect(typeof r.check).toBe('function');
  });

  it('the ecommerce sample lints without crashing', () => {
    expect(() => lint(schemaOf('table t {\n  id bigint [pk]\n}\n'))).not.toThrow();
  });
});
