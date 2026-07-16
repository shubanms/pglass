// Wires the app to persistence (PRD §14): crash recovery on load, debounced
// autosave, Open (.pgl / .sql / .pglass), and Ctrl+S save-to-disk.
import { useCallback, useEffect, useRef, useState } from 'react';
import { parse } from '../dsl/parser.ts';
import { installPersistence, recoverProject } from '../persist/autosave.ts';
import {
  type FileSystemFileHandle,
  downloadFile,
  isFsSupported,
  pickAndReadFile,
  saveAs,
  writeToHandle,
} from '../persist/fs-access.ts';
import { packProject, unpackProject } from '../persist/project.ts';
import { useStore } from '../store/index.ts';

export interface Persistence {
  fileName: string | null;
  toast: string | null;
  dismissToast: () => void;
  open: () => Promise<void>;
  save: () => Promise<void>;
  fsSupported: boolean;
}

export function usePersistence(): Persistence {
  const actions = useStore((s) => s.actions);
  const [fileName, setFileName] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const handleRef = useRef<FileSystemFileHandle | null>(null);
  const kindRef = useRef<'pgl' | 'sql' | 'pglass'>('pgl');

  // crash recovery + autosave, once
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const recovered = await recoverProject();
      if (!cancelled && recovered && recovered.tables.length > 0) {
        actions.loadSchema(recovered);
        setToast('Restored from your last session');
      }
    })();
    const unsub = installPersistence(useStore);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const open = useCallback(async () => {
    const file = await pickAndReadFile();
    if (!file) return;
    kindRef.current = file.kind;
    handleRef.current = file.handle ?? null;
    setFileName(file.name);
    if (file.kind === 'sql' && file.text) {
      actions.importSqlText(file.text);
    } else if (file.kind === 'pglass' && file.bytes) {
      actions.loadSchema(unpackProject(file.bytes, new Date().toISOString()));
    } else if (file.text) {
      actions.loadSchema(parse(file.text, new Date().toISOString()).schema);
    }
  }, [actions]);

  const save = useCallback(async () => {
    const schema = useStore.getState().schema;
    const isPglass = kindRef.current === 'pglass' || (fileName?.endsWith('.pglass') ?? false);
    const data: string | Uint8Array = isPglass
      ? packProject(schema, new Date().toISOString())
      : // .sql exports go through the generator dialog; a bare save writes .pgl
        useStore.getState().dslText;
    const name = fileName ?? `${schema.name || 'schema'}.pgl`;

    if (handleRef.current) {
      await writeToHandle(handleRef.current, data);
      setToast(`Saved ${handleRef.current.name}`);
    } else {
      const handle = await saveAs(name, data);
      if (handle) {
        handleRef.current = handle;
        setFileName(handle.name);
        setToast(`Saved ${handle.name}`);
      } else if (!isFsSupported()) {
        downloadFile(name, data);
        setToast(`Downloaded ${name}`);
      }
    }
  }, [fileName]);

  // Cmd/Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  return {
    fileName,
    toast,
    dismissToast: () => setToast(null),
    open,
    save,
    fsSupported: isFsSupported(),
  };
}
