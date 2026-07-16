// CodeMirror-backed editor for the .pgl DSL, wired bidirectionally to the store.
import { autocompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { lintGutter } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { pglAutocomplete } from '../dsl/cm-autocomplete.ts';
import { pgl } from '../dsl/cm-language.ts';
import { pglLinter } from '../dsl/cm-lint.ts';
import { diffLines } from '../lib/diff-lines.ts';
import { useStore } from '../store/index.ts';

export function EditorPane() {
  const parent = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Guard: true while we are pushing store→editor, so the update listener
  // doesn't echo it back into the store.
  const applyingExternal = useRef(false);

  useEffect(() => {
    if (!parent.current) return;
    const state = EditorState.create({
      doc: useStore.getState().dslText,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        indentOnInput(),
        lintGutter(),
        pgl(),
        pglLinter(),
        autocompletion({ override: [pglAutocomplete(() => useStore.getState().schema)] }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, monospace" },
          '.cm-gutters': {
            background: 'var(--bg-panel)',
            color: 'var(--text-muted)',
            border: 'none',
          },
          '&.cm-focused': { outline: 'none' },
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !applyingExternal.current) {
            useStore.getState().actions.setDslText(u.state.doc.toString());
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: parent.current });
    viewRef.current = view;

    // Push store→editor whenever dslText changes from a non-editor source
    // (canvas edits, undo/redo, sample load).
    const unsub = useStore.subscribe((s) => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (s.dslText !== current) {
        // Apply a *minimal* line-level diff (PRD §8, cursor preservation): only
        // the lines that actually changed are rewritten, so CodeMirror maps the
        // caret through untouched lines and it doesn't jump when a model change
        // (e.g. dragging a table) reprints the document under the user.
        const changes = diffLines(current, s.dslText);
        if (changes.length) {
          applyingExternal.current = true;
          view.dispatch({ changes });
          applyingExternal.current = false;
        }
      }
    });

    return () => {
      unsub();
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  return <div ref={parent} className="h-full overflow-hidden" />;
}
