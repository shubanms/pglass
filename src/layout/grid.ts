import { tableSize } from '../canvas/geometry.ts';
// A cheap deterministic grid layout, used as a stopgap until the elkjs
// auto-layout (PRD §12.5, Phase 8) lands. Imported / freshly-parsed schemas
// have every table at (0,0); this spreads them into a readable grid.
import type { Schema } from '../model/types.ts';

const GAP_X = 80;
const GAP_Y = 60;

/** True if the schema has no meaningful layout (all tables share one point). */
export function needsLayout(schema: Schema): boolean {
  if (schema.tables.length <= 1) return false;
  const first = schema.tables[0]!.pos;
  return schema.tables.every((t) => t.pos.x === first.x && t.pos.y === first.y);
}

export function gridLayout(schema: Schema): Schema {
  const n = schema.tables.length;
  if (n === 0) return schema;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));

  // Column widths / row heights sized to the widest / tallest member.
  const sizes = schema.tables.map((t) => tableSize(t));
  const colWidth: number[] = [];
  const rowHeight: number[] = [];
  schema.tables.forEach((_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    colWidth[c] = Math.max(colWidth[c] ?? 0, sizes[i]!.w);
    rowHeight[r] = Math.max(rowHeight[r] ?? 0, sizes[i]!.h);
  });

  const colX: number[] = [];
  let x = 40;
  for (let c = 0; c < cols; c++) {
    colX[c] = x;
    x += (colWidth[c] ?? 0) + GAP_X;
  }
  const rowY: number[] = [];
  let y = 40;
  const rows = Math.ceil(n / cols);
  for (let r = 0; r < rows; r++) {
    rowY[r] = y;
    y += (rowHeight[r] ?? 0) + GAP_Y;
  }

  return {
    ...schema,
    tables: schema.tables.map((t, i) => ({
      ...t,
      pos: { x: colX[i % cols] ?? 40, y: rowY[Math.floor(i / cols)] ?? 40 },
    })),
  };
}
