// The .pglass project file (PRD §14.3): a zip of a human-readable schema.pgl
// (the source of truth) + layout.json (visual state the DSL doesn't encode) +
// meta.json (extensions / preserved raw SQL). Never an opaque binary format.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parse } from '../dsl/parser.ts';
import { print } from '../dsl/printer.ts';
import type { Relationship, Schema, Table } from '../model/types.ts';

interface TableLayout {
  pos: { x: number; y: number };
  size?: { w: number; h: number };
  collapsed?: boolean;
  color?: string;
  group?: string; // group name
}
interface RelLayout {
  key: string;
  waypoints?: { x: number; y: number }[];
  color?: string;
}
interface Layout {
  tables: Record<string, TableLayout>;
  enums: Record<string, { pos?: { x: number; y: number }; color?: string }>;
  rels: RelLayout[];
  groups: Record<string, { collapsed?: boolean; color?: string }>;
  notes: Schema['notes'];
}
interface Meta {
  version: 1;
  name: string;
  description?: string;
  extensions?: string[];
  rawObjects?: { kind: string; name: string; sql: string }[];
  savedAt: string;
}

const tableKey = (t: Table) => `${t.namespace}.${t.name}`;

function relKey(schema: Schema, r: Relationship): string {
  const src = schema.tables.find((t) => t.id === r.sourceTable);
  const tgt = schema.tables.find((t) => t.id === r.targetTable);
  const sc = r.sourceColumns
    .map((id) => src?.columns.find((c) => c.id === id)?.name ?? id)
    .join(',');
  const tc = r.targetColumns
    .map((id) => tgt?.columns.find((c) => c.id === id)?.name ?? id)
    .join(',');
  return `${src?.name}(${sc})->${tgt?.name}(${tc})`;
}

export function extractLayout(schema: Schema): Layout {
  const groupNameById = new Map(schema.groups.map((g) => [g.id, g.name] as const));
  const tables: Layout['tables'] = {};
  for (const t of schema.tables) {
    tables[tableKey(t)] = {
      pos: t.pos,
      size: t.size,
      collapsed: t.collapsed,
      color: t.color,
      group: t.groupId ? groupNameById.get(t.groupId) : undefined,
    };
  }
  const enums: Layout['enums'] = {};
  for (const e of schema.enums) {
    if (e.pos || e.color) enums[`${e.namespace}.${e.name}`] = { pos: e.pos, color: e.color };
  }
  const rels: RelLayout[] = schema.relationships
    .filter((r) => r.waypoints || r.color)
    .map((r) => ({ key: relKey(schema, r), waypoints: r.waypoints, color: r.color }));
  const groups: Layout['groups'] = {};
  for (const g of schema.groups) groups[g.name] = { collapsed: g.collapsed, color: g.color };

  return { tables, enums, rels, groups, notes: schema.notes };
}

export function applyLayout(schema: Schema, layout: Layout): Schema {
  const groupIdByName = new Map(schema.groups.map((g) => [g.name.toLowerCase(), g.id] as const));
  const tables = schema.tables.map((t) => {
    const l = layout.tables[tableKey(t)];
    if (!l) return t;
    return {
      ...t,
      pos: l.pos ?? t.pos,
      size: l.size ?? t.size,
      collapsed: l.collapsed ?? t.collapsed,
      color: l.color ?? t.color,
      groupId: l.group ? (groupIdByName.get(l.group.toLowerCase()) ?? t.groupId) : t.groupId,
    };
  });
  const enums = schema.enums.map((e) => {
    const l = layout.enums[`${e.namespace}.${e.name}`];
    return l ? { ...e, pos: l.pos ?? e.pos, color: l.color ?? e.color } : e;
  });
  const relByKey = new Map(layout.rels.map((r) => [r.key, r] as const));
  const relationships = schema.relationships.map((r) => {
    const l = relByKey.get(relKey(schema, r));
    return l ? { ...r, waypoints: l.waypoints ?? r.waypoints, color: l.color ?? r.color } : r;
  });
  const groups = schema.groups.map((g) => {
    const l = layout.groups[g.name];
    return l ? { ...g, collapsed: l.collapsed ?? g.collapsed, color: l.color ?? g.color } : g;
  });
  return { ...schema, tables, enums, relationships, groups, notes: layout.notes ?? schema.notes };
}

/** Serialize a schema to a .pglass zip (Uint8Array). */
export function packProject(schema: Schema, savedAt = '1970-01-01T00:00:00.000Z'): Uint8Array {
  const meta: Meta = {
    version: 1,
    name: schema.name,
    description: schema.meta.description,
    extensions: schema.meta.extensions,
    rawObjects: schema.meta.rawObjects,
    savedAt,
  };
  return zipSync({
    'schema.pgl': strToU8(print(schema)),
    'layout.json': strToU8(`${JSON.stringify(extractLayout(schema), null, 2)}\n`),
    'meta.json': strToU8(`${JSON.stringify(meta, null, 2)}\n`),
  });
}

/** Reconstruct a schema from a .pglass zip. */
export function unpackProject(bytes: Uint8Array, now = '1970-01-01T00:00:00.000Z'): Schema {
  const files = unzipSync(bytes);
  const pgl = files['schema.pgl'] ? strFromU8(files['schema.pgl']) : '';
  const parsed = parse(pgl, now).schema;

  let schema = parsed;
  if (files['layout.json']) {
    try {
      schema = applyLayout(schema, JSON.parse(strFromU8(files['layout.json'])) as Layout);
    } catch {
      // corrupt layout — keep the parsed schema
    }
  }
  if (files['meta.json']) {
    try {
      const meta = JSON.parse(strFromU8(files['meta.json'])) as Meta;
      schema = {
        ...schema,
        name: meta.name || schema.name,
        meta: {
          ...schema.meta,
          description: meta.description ?? schema.meta.description,
          extensions: meta.extensions,
          rawObjects: meta.rawObjects,
        },
      };
    } catch {
      // corrupt meta — ignore
    }
  }
  return schema;
}
