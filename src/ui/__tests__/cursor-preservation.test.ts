import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { diffLines } from '../../lib/diff-lines.ts';

// Proves the property EditorPane relies on (PRD §8, cursor preservation): when a
// model-initiated reprint rewrites the document, applying the *line-level* diff
// keeps the caret on the line it was on — because untouched lines are never part
// of any change, so CodeMirror maps the position to itself. A naive full-document
// replace (from: 0, to: end) would instead shove the caret to the end.

/** Where does `caret` land after applying `diffLines(old,new)` as a transaction? */
function caretAfterDiff(oldDoc: string, newDoc: string, caret: number) {
  const state = EditorState.create({
    doc: oldDoc,
    selection: EditorSelection.single(caret),
  });
  const tr = state.update({ changes: diffLines(oldDoc, newDoc) });
  return { pos: tr.state.selection.main.head, doc: tr.state.doc.toString() };
}

describe('cursor preservation via line diff', () => {
  it('keeps the caret on an unchanged line when a later line changes', () => {
    const old = 'table users {\n  id bigint\n  age integer\n}\n';
    const next = 'table users {\n  id bigint\n  age bigint\n}\n';
    // caret sits inside "id bigint" (line 2) — an untouched line
    const caret = old.indexOf('id bigint') + 2;
    const { pos, doc } = caretAfterDiff(old, next, caret);
    expect(doc).toBe(next); // the edit still applied
    // caret still points at the same characters on the same line
    expect(next.slice(pos - 2, pos + 7)).toBe(old.slice(caret - 2, caret + 7));
  });

  it('keeps the caret put when statements below are reordered (drag reprint)', () => {
    const a = 'table a {\n  id bigint\n}\n';
    const b = 'table b {\n  id bigint\n}\n';
    const c = 'table c {\n  id bigint\n}\n';
    const old = a + b + c;
    const next = b + c + a; // table a moved to the end (as a drag might reprint)
    // caret inside table b's body, which does not move relative to its own text
    const caret = old.indexOf('table b') + 3;
    const { pos, doc } = caretAfterDiff(old, next, caret);
    expect(doc).toBe(next);
    // the caret is still within the "table b" line in the new document
    const line = tr_lineText(next, pos);
    expect(line).toContain('table b');
  });

  it('a naive full replace would NOT preserve it (contrast)', () => {
    const old = 'table users {\n  id bigint\n  age integer\n}\n';
    const next = 'table users {\n  id bigint\n  age bigint\n}\n';
    const caret = old.indexOf('id bigint') + 2;
    const state = EditorState.create({ doc: old, selection: EditorSelection.single(caret) });
    const tr = state.update({ changes: { from: 0, to: old.length, insert: next } });
    // full replace collapses the whole document into one change, so the caret is
    // dumped to a document boundary (CodeMirror maps it to 0) instead of staying
    // on its line — exactly the jump the line diff avoids.
    expect(tr.state.selection.main.head).toBe(0);
    expect(tr.state.selection.main.head).not.toBe(caret);
  });
});

function tr_lineText(doc: string, pos: number): string {
  const start = doc.lastIndexOf('\n', pos - 1) + 1;
  const endNl = doc.indexOf('\n', pos);
  return doc.slice(start, endNl === -1 ? undefined : endNl);
}
