import { describe, expect, it } from 'vitest';
import { parse } from '../parser.ts';
import { print } from '../printer.ts';

describe('view DSL', () => {
  it('parses a plain view', () => {
    const src = `view active_users {
  '''
  select * from users where deleted_at is null
  '''
}
`;
    const { schema, diagnostics } = parse(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(schema.views).toHaveLength(1);
    const v = schema.views[0]!;
    expect(v.name).toBe('active_users');
    expect(v.materialized).toBe(false);
    expect(v.query).toContain('select * from users');
  });

  it('parses a materialized view with settings', () => {
    const src = `view sales_by_day [materialized, color: #059669] {
  '''
  select date_trunc('day', placed_at) d, sum(total_cents) from orders group by 1
  '''
}
`;
    const { schema } = parse(src);
    const v = schema.views[0]!;
    expect(v.materialized).toBe(true);
    expect(v.color).toBe('#059669');
  });

  it('round-trips byte-exactly', () => {
    const src = `view active_users {
  '''
  select *
  from users
  where deleted_at is null
  '''
}

view sales_by_day [materialized] {
  '''
  select 1
  '''
}

table users {
  id  bigint [pk]
}
`;
    expect(print(parse(src).schema)).toBe(src);
  });

  it('deep-equals on reparse (parse∘print∘parse)', () => {
    const src = `view v [materialized, color: #dc2626] {
  '''
  select a, b from t
  '''
}
`;
    const once = parse(src).schema;
    const twice = parse(print(once)).schema;
    expect(twice.views[0]).toMatchObject({
      name: 'v',
      materialized: true,
      color: '#dc2626',
      query: once.views[0]!.query,
    });
  });
});
