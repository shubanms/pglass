// Graph utilities: topological ordering with cycle tolerance. Used by the
// generators (FK-ordered output) and the seed generator (cycle breaking).

/**
 * Kahn's algorithm. `edges` are [from, to] meaning `from` must come before `to`.
 * Returns a best-effort order; if the graph has a cycle, the remaining nodes are
 * appended in their input order and `cyclic` is true.
 */
export function graphTopoOrder<T>(nodes: T[], edges: [T, T][]): { order: T[]; cyclic: boolean } {
  const indegree = new Map<T, number>();
  const adj = new Map<T, T[]>();
  for (const n of nodes) {
    indegree.set(n, 0);
    adj.set(n, []);
  }
  for (const [from, to] of edges) {
    if (!indegree.has(from) || !indegree.has(to)) continue;
    adj.get(from)!.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }

  // Seed the queue in input order for determinism.
  const queue: T[] = nodes.filter((n) => (indegree.get(n) ?? 0) === 0);
  const order: T[] = [];
  const seen = new Set<T>();
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    order.push(n);
    for (const m of adj.get(n) ?? []) {
      indegree.set(m, (indegree.get(m) ?? 0) - 1);
      if ((indegree.get(m) ?? 0) === 0) queue.push(m);
    }
  }

  const cyclic = order.length < nodes.length;
  if (cyclic) {
    for (const n of nodes) if (!seen.has(n)) order.push(n);
  }
  return { order, cyclic };
}

/** Detect whether the directed graph has any cycle. */
export function hasCycle<T>(nodes: T[], edges: [T, T][]): boolean {
  return graphTopoOrder(nodes, edges).cyclic;
}
