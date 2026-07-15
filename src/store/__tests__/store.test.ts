import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser.ts';
import { print } from '../../dsl/printer.ts';
import { useStore } from '../index.ts';

const SAMPLE = `table users {
  id     bigint [pk, increment]
  email  text
}
`;

function resetStore() {
  useStore.getState().actions.loadSchema(parse(SAMPLE).schema);
  useStore.temporal.getState().clear();
}

describe('store sync loop (§8)', () => {
  beforeEach(resetStore);

  it('loadSchema populates canonical text', () => {
    expect(useStore.getState().dslText).toBe(SAMPLE);
  });

  it('text edit updates the model without errors', () => {
    const next =
      'table users {\n  id     bigint [pk, increment]\n  email  text\n  age    integer\n}\n';
    useStore.getState().actions.setDslText(next);
    const s = useStore.getState();
    expect(s.stale).toBe(false);
    expect(s.schema.tables[0]?.columns.some((c) => c.name === 'age')).toBe(true);
  });

  it('keeps the last-good model and marks stale on a parse error', () => {
    const before = useStore.getState().schema;
    // duplicate column name → PGL006 error
    useStore.getState().actions.setDslText('table users {\n  id bigint [pk]\n  id text\n}\n');
    const after = useStore.getState();
    // schema unchanged (canvas keeps rendering), but flagged stale
    expect(after.stale).toBe(true);
    expect(after.schema).toBe(before);
    expect(after.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('a model mutation reprints canonical text (no oscillation)', () => {
    const id = useStore.getState().schema.tables[0]!.id;
    useStore.getState().actions.addColumn(id, { name: 'nickname' });
    const text1 = useStore.getState().dslText;
    // feeding that text back is a no-op echo (reprint guard)
    useStore.getState().actions.setDslText(text1);
    const text2 = print(useStore.getState().schema);
    expect(text2).toBe(text1);
  });

  it('renaming a table in text preserves its position', () => {
    const id = useStore.getState().schema.tables[0]!.id;
    useStore.getState().actions.moveTables([id], 300, 150);
    const posBefore = useStore.getState().schema.tables[0]!.pos;
    expect(posBefore).toEqual({ x: 300, y: 150 });

    const renamed = useStore.getState().dslText.replace('table users', 'table people');
    useStore.getState().actions.setDslText(renamed);

    const t = useStore.getState().schema.tables[0]!;
    expect(t.name).toBe('people');
    expect(t.pos).toEqual({ x: 300, y: 150 }); // position survived the rename
  });

  it('undo restores both model and text', () => {
    const id = useStore.getState().schema.tables[0]!.id;
    useStore.getState().actions.addColumn(id, { name: 'extra' });
    expect(useStore.getState().schema.tables[0]!.columns.some((c) => c.name === 'extra')).toBe(
      true,
    );

    useStore.getState().actions.undo();
    const s = useStore.getState();
    expect(s.schema.tables[0]!.columns.some((c) => c.name === 'extra')).toBe(false);
    expect(s.dslText).toBe(SAMPLE); // text resynced to the undone model
  });
});
