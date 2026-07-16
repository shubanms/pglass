// Autosave + snapshot + crash-recovery orchestration (PRD §14.1). Subscribes to
// the store and debounce-persists the current project to IndexedDB; snapshots on
// large changes; restores the last session on load.
import { print } from '../dsl/printer.ts';
import type { Schema } from '../model/types.ts';
import type { useStore as UseStore } from '../store/index.ts';
import {
  addSnapshot,
  getSetting,
  loadCurrentProject,
  saveCurrentProject,
  setSetting,
} from './db.ts';
import { packProject, unpackProject } from './project.ts';

const AUTOSAVE_MS = 800;
const SNAPSHOT_TABLE_DELTA = 5;
const CURRENT_KEY = 'currentProjectId';

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSnapshotTableCount = 0;
let currentProjectId: number | null = null;

const now = () => new Date().toISOString();

async function persist(schema: Schema, snapshot: boolean): Promise<void> {
  const bytes = packProject(schema, now());
  currentProjectId = await saveCurrentProject(schema.name || 'untitled', bytes, now());
  if (snapshot) {
    await addSnapshot(currentProjectId, print(schema), now(), 'auto');
    lastSnapshotTableCount = schema.tables.length;
  }
}

/** Wire the store to IndexedDB. Returns an unsubscribe function. Only schema
 *  changes trigger a save — viewport/selection churn is ignored. */
export function installPersistence(store: typeof UseStore): () => void {
  return store.subscribe((state, prev) => {
    if (state.schema === prev.schema) return;
    const schema = state.schema;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const delta = Math.abs(schema.tables.length - lastSnapshotTableCount);
      void persist(schema, delta > SNAPSHOT_TABLE_DELTA);
    }, AUTOSAVE_MS);
  });
}

/** Explicit snapshot (e.g. before import / on export / on auto-layout). */
export async function snapshotNow(schema: Schema, label: string): Promise<void> {
  if (currentProjectId == null) {
    const bytes = packProject(schema, now());
    currentProjectId = await saveCurrentProject(schema.name || 'untitled', bytes, now());
  }
  await addSnapshot(currentProjectId, print(schema), now(), label);
  lastSnapshotTableCount = schema.tables.length;
}

/** Restore the autosaved project from the last session, if any. */
export async function recoverProject(): Promise<Schema | null> {
  const row = await loadCurrentProject();
  if (!row) return null;
  const id = await getSetting<number>(CURRENT_KEY);
  if (id != null) currentProjectId = id;
  try {
    const schema = unpackProject(row.pglass, now());
    lastSnapshotTableCount = schema.tables.length;
    return schema;
  } catch {
    return null;
  }
}

export async function clearRecovery(): Promise<void> {
  await setSetting(CURRENT_KEY, null);
  currentProjectId = null;
}
