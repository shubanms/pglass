// Global keyboard shortcuts (PRD §15.2). Canvas-local keys (F, 1, Delete, Esc)
// live in Canvas.tsx; this handles the app-wide and Cmd-based bindings. Bindings
// that would clobber editing (undo, select-all, duplicate, layout, new-table)
// are suppressed while focus is inside the editor or a form field, so CodeMirror
// keeps its own Cmd+Z / Cmd+A / Cmd+F.
import { useEffect } from 'react';
import { useStore } from '../store/index.ts';

export interface ShortcutHandlers {
  openPalette: () => void;
  openImport: () => void;
  openExport: () => void;
  openDiff: () => void;
  openImage: () => void;
  save: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    !!target.closest('.cm-editor') ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export function useShortcuts(h: ShortcutHandlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const { actions, ui } = useStore.getState();

      // These work everywhere, including inside the editor.
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        h.openPalette();
        return;
      }
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        h.save();
        return;
      }
      if (meta && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        h.openExport();
        return;
      }
      if (meta && e.key === '\\') {
        e.preventDefault();
        actions.setUi('editorPane', ui.editorPane === 'hidden' ? 'split' : 'hidden');
        return;
      }
      if (meta && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        actions.toggleUi('leftPanel');
        return;
      }
      if (meta && e.key === '/') {
        e.preventDefault();
        actions.setUi('bottomPanel', { open: !ui.bottomPanel.open, tab: ui.bottomPanel.tab });
        return;
      }

      // The rest must not fire while the user is typing.
      if (isTyping(e.target)) return;

      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        actions.undo();
      } else if (
        meta &&
        ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y')
      ) {
        e.preventDefault();
        actions.redo();
      } else if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        actions.selectAllTables();
      } else if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        actions.duplicateSelection();
      } else if (meta && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        void actions.autoLayout('layered');
      } else if (!meta && (e.key === 't' || e.key === 'T') && !e.shiftKey) {
        actions.addTable();
      } else if (!meta && e.key === 'F' && e.shiftKey) {
        actions.focusSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [h]);
}
