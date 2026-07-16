import { describe, expect, it } from 'vitest';
import { parse } from '../parser.ts';
import { print } from '../printer.ts';

describe('function DSL', () => {
  it('parses a plpgsql function', () => {
    const src = `function set_updated_at() returns trigger language plpgsql {
  '''
  begin
    new.updated_at = now();
    return new;
  end
  '''
}
`;
    const { schema, diagnostics } = parse(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(schema.routines).toHaveLength(1);
    const r = schema.routines[0]!;
    expect(r.name).toBe('set_updated_at');
    expect(r.args).toBe('');
    expect(r.returns).toBe('trigger');
    expect(r.language).toBe('plpgsql');
    expect(r.body).toContain('new.updated_at');
  });

  it('captures args and return type verbatim', () => {
    const src = `function add(a integer, b integer) returns integer language sql {
  '''
  select a + b
  '''
}
`;
    const r = parse(src).schema.routines[0]!;
    expect(r.args).toBe('a integer, b integer');
    expect(r.returns).toBe('integer');
  });

  it('round-trips byte-exactly', () => {
    const src = `function add(a integer, b integer) returns integer language sql {
  '''
  select a + b
  '''
}

function touch() returns trigger language plpgsql {
  '''
  begin
    return new;
  end
  '''
}
`;
    expect(print(parse(src).schema)).toBe(src);
  });
});

describe('trigger DSL', () => {
  const SRC = `function touch() returns trigger language plpgsql {
  '''
  begin
    new.updated_at = now();
    return new;
  end
  '''
}

table orders {
  id          bigint [pk]
  updated_at  timestamptz
}

trigger orders_touch on orders [before, insert, update, row] exec touch
`;

  it('parses a trigger attached to its table', () => {
    const { schema, diagnostics } = parse(SRC);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(schema.triggers).toHaveLength(1);
    const tg = schema.triggers[0]!;
    expect(tg.name).toBe('orders_touch');
    expect(tg.timing).toBe('before');
    expect(tg.events).toEqual(['insert', 'update']);
    expect(tg.level).toBe('row');
    expect(tg.functionName).toBe('touch');
    const orders = schema.tables.find((t) => t.name === 'orders')!;
    expect(tg.table).toBe(orders.id);
  });

  it('round-trips byte-exactly', () => {
    expect(print(parse(SRC).schema)).toBe(SRC);
  });

  it('errors on a trigger for an unknown table', () => {
    const { diagnostics } = parse('trigger t on nope [after, delete, row] exec f\n');
    expect(diagnostics.some((d) => d.code === 'PGL014')).toBe(true);
  });
});
