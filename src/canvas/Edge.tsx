import type { Relationship, Schema } from '../model/types.ts';
import { routeEdge } from './geometry.ts';
import { CrowFoot } from './markers.tsx';

export function Edge({
  schema,
  rel,
  style,
  highlighted,
  dimmed,
  compact,
}: {
  schema: Schema;
  rel: Relationship;
  style: 'orthogonal' | 'bezier' | 'straight';
  highlighted?: boolean;
  dimmed?: boolean;
  compact?: boolean;
}) {
  const geo = routeEdge(schema, rel, style, compact);
  if (!geo) return null;
  const color = rel.color ?? (highlighted ? 'var(--accent)' : 'var(--edge)');
  const cascade = rel.onDelete === 'cascade';

  // midpoint of the path bbox for the CASCADE badge
  const midX = (geo.source.x + geo.target.x) / 2;
  const midY = (geo.source.y + geo.target.y) / 2;

  return (
    <g
      className="pgl-edge"
      style={{ opacity: dimmed ? 0.18 : 1, transition: 'opacity 150ms ease' }}
    >
      <path d={geo.path} fill="none" stroke={color} strokeWidth={highlighted ? 2 : 1.5} />
      <CrowFoot {...geo.source} color={color} />
      <CrowFoot {...geo.target} color={color} />
      {cascade && (
        <g>
          <rect
            x={midX - 30}
            y={midY - 8}
            width={60}
            height={16}
            rx={3}
            fill="var(--bg-elevated)"
            stroke={color}
            strokeWidth={0.75}
          />
          <text x={midX} y={midY + 3} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
            ON DELETE
          </text>
        </g>
      )}
    </g>
  );
}
