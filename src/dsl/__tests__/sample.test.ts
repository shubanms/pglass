import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '../parser.ts';
import { print } from '../printer.ts';

// vitest runs with cwd = project root.
const text = readFileSync(resolve(process.cwd(), 'public/samples/ecommerce.pgl'), 'utf8');

describe('ecommerce sample', () => {
  it('parses with zero error diagnostics', () => {
    const { diagnostics } = parse(text);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('has the expected shape', () => {
    const { schema } = parse(text);
    expect(schema.tables.length).toBe(4);
    expect(schema.relationships.length).toBe(3);
    expect(schema.enums.length).toBe(1);
    expect(schema.groups.length).toBe(1);
  });

  it('round-trips byte-exactly (the sample is canonical)', () => {
    expect(print(parse(text).schema)).toBe(text);
  });
});
