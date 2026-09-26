export function resolveDependencies(graph) {
  // BUG: Returns raw keys without topological sort or cycle detection
  return Object.keys(graph);
}
