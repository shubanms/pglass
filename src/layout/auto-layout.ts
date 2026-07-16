// elkjs-powered auto-layout (PRD §12.5). Returns new positions keyed by table
// id; the store applies + animates them. Runs elkjs on demand — for very large
// schemas this can be moved into a Worker, but the API here stays the same.
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import { tableSize } from '../canvas/geometry.ts';
import type { Schema, TableId } from '../model/types.ts';

export type LayoutAlgo = 'layered' | 'force' | 'radial';

// elkjs is large (~1.4 MB) — load it lazily so it stays out of the main bundle.
interface ElkLike {
  layout(graph: ElkNode): Promise<{ children?: { id: string; x?: number; y?: number }[] }>;
}
let elkPromise: Promise<ElkLike> | null = null;
function getElk(): Promise<ElkLike> {
  if (!elkPromise) {
    elkPromise = import('elkjs/lib/elk.bundled.js').then(
      (m) => new m.default() as unknown as ElkLike,
    );
  }
  return elkPromise;
}

function options(algo: LayoutAlgo): Record<string, string> {
  switch (algo) {
    case 'force':
      return {
        'elk.algorithm': 'force',
        'elk.spacing.nodeNode': '80',
      };
    case 'radial':
      return {
        'elk.algorithm': 'radial',
        'elk.spacing.nodeNode': '60',
      };
    default:
      return {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '100',
        'elk.edgeRouting': 'ORTHOGONAL',
      };
  }
}

/** Compute new positions for every table. Selection-only layout is supported by
 *  passing `only` — untouched tables keep their positions. */
export async function autoLayout(
  schema: Schema,
  algo: LayoutAlgo = 'layered',
  only?: Set<TableId>,
): Promise<Map<TableId, { x: number; y: number }>> {
  const laidOut = only ? schema.tables.filter((t) => only.has(t.id)) : schema.tables;
  if (laidOut.length === 0) return new Map();

  const ids = new Set(laidOut.map((t) => t.id));
  const children: ElkNode[] = laidOut.map((t) => {
    const { w, h } = tableSize(t);
    return { id: t.id, width: w, height: h };
  });
  // Edge direction parent → child (referenced table → FK holder) so the
  // layered algorithm places parents on the left, children flowing right.
  const edges = schema.relationships
    .filter(
      (r) => ids.has(r.sourceTable) && ids.has(r.targetTable) && r.sourceTable !== r.targetTable,
    )
    .map((r, i) => ({ id: `e${i}`, sources: [r.targetTable], targets: [r.sourceTable] }));

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: options(algo),
    children,
    edges: edges as unknown as ElkNode['edges'],
  };

  const elk = await getElk();
  const result = await elk.layout(graph);
  const out = new Map<TableId, { x: number; y: number }>();

  // Offset so the laid-out cluster starts near a sensible origin. For
  // selection-only layout, anchor at the bounding box of the current selection.
  let originX = 40;
  let originY = 40;
  if (only) {
    originX = Math.min(...laidOut.map((t) => t.pos.x));
    originY = Math.min(...laidOut.map((t) => t.pos.y));
  }

  for (const node of result.children ?? []) {
    out.set(node.id as TableId, {
      x: Math.round((node.x ?? 0) + originX),
      y: Math.round((node.y ?? 0) + originY),
    });
  }
  return out;
}
