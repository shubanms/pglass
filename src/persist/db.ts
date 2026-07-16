// IndexedDB persistence via Dexie (PRD §14.1). Autosaved project + snapshots +
// settings. A single "current" project row is kept for crash recovery.
import Dexie, { type Table as DexieTable } from 'dexie';

export interface ProjectRow {
  id?: number;
  name: string;
  updatedAt: string;
  /** the .pglass bytes (zip of schema.pgl + layout.json + meta.json) */
  pglass: Uint8Array;
}

export interface SnapshotRow {
  id?: number;
  projectId: number;
  createdAt: string;
  label?: string;
  /** the .pgl DSL text of the snapshot */
  pgl: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export class PglassDB extends Dexie {
  projects!: DexieTable<ProjectRow, number>;
  snapshots!: DexieTable<SnapshotRow, number>;
  settings!: DexieTable<SettingRow, string>;

  constructor(name = 'pglass') {
    super(name);
    this.version(1).stores({
      projects: '++id, name, updatedAt',
      snapshots: '++id, projectId, createdAt',
      settings: 'key',
    });
  }
}

export const db = new PglassDB();

const CURRENT_KEY = 'currentProjectId';
const MAX_SNAPSHOTS = 50;

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const row = await db.settings.get(key);
  return row?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

/** Upsert the single autosaved project and remember its id for crash recovery. */
export async function saveCurrentProject(
  name: string,
  pglass: Uint8Array,
  now: string,
): Promise<number> {
  const currentId = await getSetting<number>(CURRENT_KEY);
  if (currentId != null && (await db.projects.get(currentId))) {
    await db.projects.update(currentId, { name, pglass, updatedAt: now });
    return currentId;
  }
  const id = await db.projects.add({ name, pglass, updatedAt: now });
  await setSetting(CURRENT_KEY, id);
  return id;
}

export async function loadCurrentProject(): Promise<ProjectRow | undefined> {
  const currentId = await getSetting<number>(CURRENT_KEY);
  if (currentId == null) return undefined;
  return db.projects.get(currentId);
}

export async function addSnapshot(
  projectId: number,
  pgl: string,
  createdAt: string,
  label?: string,
): Promise<void> {
  await db.snapshots.add({ projectId, pgl, createdAt, ...(label ? { label } : {}) });
  // prune to the most recent MAX_SNAPSHOTS
  const all = await db.snapshots.where('projectId').equals(projectId).sortBy('createdAt');
  if (all.length > MAX_SNAPSHOTS) {
    const toDelete = all.slice(0, all.length - MAX_SNAPSHOTS).map((s) => s.id!);
    await db.snapshots.bulkDelete(toDelete);
  }
}

export async function listSnapshots(projectId: number): Promise<SnapshotRow[]> {
  const rows = await db.snapshots.where('projectId').equals(projectId).sortBy('createdAt');
  return rows.reverse(); // newest first
}
