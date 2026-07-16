import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser.ts';
import { detectJunction, isJunction, junctions } from '../junction.ts';

function schemaOf(src: string) {
  return parse(src).schema;
}

const M2M = `table users {
  id bigint [pk]
}

table roles {
  id bigint [pk]
}

table user_roles {
  user_id bigint [ref: > users.id]
  role_id bigint [ref: > roles.id]

  indexes {
    (user_id, role_id) [pk]
  }
}
`;

describe('detectJunction', () => {
  it('detects a pure link table', () => {
    const s = schemaOf(M2M);
    const jt = s.tables.find((t) => t.name === 'user_roles')!;
    const j = detectJunction(s, jt);
    expect(j).not.toBeNull();
    const parents = [j!.parentA, j!.parentB].map((id) => s.tables.find((t) => t.id === id)!.name);
    expect(parents.sort()).toEqual(['roles', 'users']);
    expect(j!.extraColumns).toBe(0);
  });

  it('allows up to two payload columns', () => {
    const s = schemaOf(`table a { id bigint [pk] }
table b { id bigint [pk] }
table ab {
  a_id bigint [ref: > a.id]
  b_id bigint [ref: > b.id]
  created_at timestamptz
  weight integer

  indexes {
    (a_id, b_id) [pk]
  }
}
`);
    const jt = s.tables.find((t) => t.name === 'ab')!;
    expect(detectJunction(s, jt)?.extraColumns).toBe(2);
  });

  it('rejects a table with three payload columns', () => {
    const s = schemaOf(`table a { id bigint [pk] }
table b { id bigint [pk] }
table ab {
  a_id bigint [ref: > a.id]
  b_id bigint [ref: > b.id]
  c1 integer
  c2 integer
  c3 integer

  indexes {
    (a_id, b_id) [pk]
  }
}
`);
    const jt = s.tables.find((t) => t.name === 'ab')!;
    expect(detectJunction(s, jt)).toBeNull();
  });

  it('rejects a table with only one FK', () => {
    const s = schemaOf(`table a { id bigint [pk] }
table b {
  id bigint [pk]
  a_id bigint [ref: > a.id]
}
`);
    const b = s.tables.find((t) => t.name === 'b')!;
    expect(isJunction(s, b)).toBe(false);
  });

  it('rejects when the PK is not exactly the two FK columns', () => {
    const s = schemaOf(`table a { id bigint [pk] }
table b { id bigint [pk] }
table ab {
  id bigint [pk]
  a_id bigint [ref: > a.id]
  b_id bigint [ref: > b.id]
}
`);
    const jt = s.tables.find((t) => t.name === 'ab')!;
    // PK is `id`, not (a_id, b_id) → not a junction
    expect(detectJunction(s, jt)).toBeNull();
  });

  it('junctions() lists every link table', () => {
    const s = schemaOf(M2M);
    expect(junctions(s).map((j) => j.table.name)).toEqual(['user_roles']);
  });
});
