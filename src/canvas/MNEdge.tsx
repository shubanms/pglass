import { newRelId } from '../model/ids.ts';
// The single dashed edge that replaces a collapsed junction table (Phase 14 /
// PRD §12.3). It connects the two parent tables and is labelled with the
// junction's name; both ends carry the "many" crow's-foot.
import type { Junction } from '../model/junction.ts';
import type { Schema } from '../model/types.ts';
import { routeEdge } from './geometry.ts';
import { CrowFoot } from './markers.tsx';

export function MNEdge({ schema, junction }: { schema: Schema; junction: Junction }) {
  // A synthetic relationship parentA → parentB, anchored on the columns the
  // junction referenced, so the route attaches to sensible ports.
  const synthetic = {
    id: newRelId(),
    sourceTable: junction.parentA,
    sourceColumns: junction.relA.targetColumns,
    targetTable: junction.parentB,
    targetColumns: junction.relB.targetColumns,
    onDelete: 'no_action' as const,
    onUpdate: 'no_action' as const,
  };
  const geo = routeEdge(schema, synthetic, 'orthogonal');
  if (!geo) return null;
  const color = 'var(--accent)';
  const midX = (geo.source.x + geo.target.x) / 2;
  const midY = (geo.source.y + geo.target.y) / 2;
  const label = junction.table.name;

  return (
    <g className="pgl-mn-edge">
      <path d={geo.path} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="6 4" />
      <CrowFoot {...geo.source} card="zero-or-many" color={color} />
      <CrowFoot {...geo.target} card="zero-or-many" color={color} />
      <g>
        <rect
          x={midX - (label.length * 3.4 + 16)}
          y={midY - 9}
          width={label.length * 6.8 + 32}
          height={18}
          rx={9}
          fill="var(--bg-elevated)"
          stroke={color}
          strokeWidth={1}
        />
        <text
          x={midX}
          y={midY + 3}
          textAnchor="middle"
          fontSize={10}
          fontWeight={600}
          fill="var(--accent)"
        >
          ⋈ {label}
        </text>
      </g>
    </g>
  );
}
