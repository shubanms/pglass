import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser.ts';
import { addSnapshot, db, listSnapshots, loadCurrentProject, saveCurrentProject } from '../db.ts';
import { packProject, unpackProject } from '../project.ts';

const NOW = '2025-01-01T00:00:00.000Z';

async function reset() {
  await db.projects.clear();
  await db.snapshots.clear();
  await db.settings.clear();
}

describe('persistence db', () => {
  beforeEach(reset);

  it('saves and reloads the current project (crash recovery)', async () => {
    const schema = parse('table users {\n  id bigint [pk]\n}\n').schema;
    await saveCurrentProject('demo', packProject(schema, NOW), NOW);

    const row = await loadCurrentProject();
    expect(row).toBeDefined();
    expect(row!.name).toBe('demo');
    const restored = unpackProject(row!.pglass);
    expect(restored.tables[0]?.name).toBe('users');
  });

  it('upserts a single current-project row (no duplicates on re-save)', async () => {
    const s = parse('table t {\n  id bigint [pk]\n}\n').schema;
    await saveCurrentProject('demo', packProject(s, NOW), NOW);
    await saveCurrentProject('demo', packProject(s, NOW), '2025-01-02T00:00:00.000Z');
    expect(await db.projects.count()).toBe(1);
  });

  it('keeps at most 50 snapshots per project, newest first', async () => {
    const projectId = await saveCurrentProject('demo', new Uint8Array([1]), NOW);
    for (let i = 0; i < 55; i++) {
      const ts = `2025-01-01T00:00:${String(i).padStart(2, '0')}.000Z`;
      await addSnapshot(projectId, `-- snapshot ${i}\n`, ts);
    }
    const snaps = await listSnapshots(projectId);
    expect(snaps.length).toBe(50);
    // newest first — the last-added (54) survives, earliest (0..4) pruned
    expect(snaps[0]?.pgl).toContain('snapshot 54');
    expect(snaps.some((s) => s.pgl.includes('snapshot 0\n'))).toBe(false);
  });
});
