import { describe, expect, it } from 'vitest';
import { parse } from '../parser.ts';
import { print } from '../printer.ts';
import { FIXTURES } from './fixtures.ts';
import { normalizeIds } from './normalize.ts';

describe('DSL round-trip', () => {
  for (const [name, text] of Object.entries(FIXTURES)) {
    it(`parses "${name}" with no error diagnostics`, () => {
      const { diagnostics } = parse(text);
      const errors = diagnostics.filter((d) => d.severity === 'error');
      expect(errors).toEqual([]);
    });

    it(`print(parse("${name}")) === original text (byte-stable)`, () => {
      const { schema } = parse(text);
      expect(print(schema)).toBe(text);
    });

    it(`parse(print(parse("${name}"))) deep-equals parse (semantic stability)`, () => {
      const first = parse(text).schema;
      const second = parse(print(first)).schema;
      expect(normalizeIds(second)).toEqual(normalizeIds(first));
    });

    it(`print is idempotent for "${name}"`, () => {
      const once = print(parse(text).schema);
      const twice = print(parse(once).schema);
      expect(twice).toBe(once);
    });
  }
});
