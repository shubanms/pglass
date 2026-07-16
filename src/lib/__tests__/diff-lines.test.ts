import { describe, expect, it } from 'vitest';
import { applyLineChanges, diffLines } from '../diff-lines.ts';

/** Every diff must reconstruct the target when applied to the source. */
function roundtrips(a: string, b: string): boolean {
  return applyLineChanges(a, diffLines(a, b)) === b;
}

describe('diffLines', () => {
  it('returns no changes for identical text', () => {
    expect(diffLines('a\nb\n', 'a\nb\n')).toEqual([]);
  });

  it('round-trips a single-line edit', () => {
    const a = 'table users {\n  id bigint\n  age integer\n}\n';
    const b = 'table users {\n  id bigint\n  age bigint\n}\n';
    expect(roundtrips(a, b)).toBe(true);
  });

  it('leaves untouched lines untouched (single change on the edited line)', () => {
    const a = 'table users {\n  id bigint\n  age integer\n}\n';
    const b = 'table users {\n  id bigint\n  age bigint\n}\n';
    const changes = diffLines(a, b);
    expect(changes).toHaveLength(1);
    // the change is confined to the "age" line, not the whole document
    expect(a.slice(changes[0]!.from, changes[0]!.to)).toContain('age integer');
    expect(changes[0]!.insert).toContain('age bigint');
  });

  it('handles a block reorder with a minimal move (not a full replace)', () => {
    const t1 = 'table a {\n  id bigint\n}\n';
    const t2 = 'table b {\n  id bigint\n}\n';
    const t3 = 'table c {\n  id bigint\n}\n';
    const a = t1 + t2 + t3;
    const b = t2 + t3 + t1; // a moved to the end
    expect(roundtrips(a, b)).toBe(true);
    // it must not rewrite the whole document
    const changed = diffLines(a, b).reduce((n, c) => n + (c.to - c.from), 0);
    expect(changed).toBeLessThan(a.length);
  });

  it('round-trips pure insertion at the end', () => {
    expect(roundtrips('a\nb\n', 'a\nb\nc\n')).toBe(true);
  });

  it('round-trips pure insertion at the start', () => {
    expect(roundtrips('b\nc\n', 'a\nb\nc\n')).toBe(true);
  });

  it('round-trips pure deletion', () => {
    expect(roundtrips('a\nb\nc\n', 'a\nc\n')).toBe(true);
  });

  it('round-trips when the trailing newline is absent', () => {
    expect(roundtrips('a\nb', 'a\nX')).toBe(true);
    expect(roundtrips('a\nb\n', 'a\nb')).toBe(true);
    expect(roundtrips('a\nb', 'a\nb\n')).toBe(true);
  });

  it('round-trips to and from empty', () => {
    expect(roundtrips('', 'a\nb\n')).toBe(true);
    expect(roundtrips('a\nb\n', '')).toBe(true);
  });

  it('produces non-overlapping ascending changes', () => {
    const a = 'l1\nl2\nl3\nl4\nl5\nl6\n';
    const b = 'l1\nX\nl3\nl4\nY\nl6\n';
    const changes = diffLines(a, b);
    for (let i = 1; i < changes.length; i++) {
      expect(changes[i]!.from).toBeGreaterThanOrEqual(changes[i - 1]!.to);
    }
    expect(roundtrips(a, b)).toBe(true);
  });

  it('round-trips a fuzz of random line edits', () => {
    // deterministic LCG so the test is reproducible without Math.random
    let seed = 123456789;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const mkLines = (n: number) =>
      Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(rand() * 8)));
    for (let iter = 0; iter < 300; iter++) {
      const a = `${mkLines(Math.floor(rand() * 10)).join('\n')}\n`;
      const b = `${mkLines(Math.floor(rand() * 10)).join('\n')}\n`;
      expect(applyLineChanges(a, diffLines(a, b))).toBe(b);
    }
  });
});
