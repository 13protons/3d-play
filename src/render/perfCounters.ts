/**
 * Lightweight React-render counters for the perf log. Instrumented components
 * call countRender() in their render body; PerfLogger drains the tally once per
 * second to report renders/sec — the direct signal for the per-tick re-render
 * cost that P2 targets.
 */

const renderCounts: Record<string, number> = {}

export function countRender(label: string): void {
  renderCounts[label] = (renderCounts[label] ?? 0) + 1
}

/** Read and zero the accumulated counts (one window's worth). */
export function drainRenderCounts(): Record<string, number> {
  const drained: Record<string, number> = {}
  for (const key of Object.keys(renderCounts)) {
    drained[key] = renderCounts[key]
    renderCounts[key] = 0
  }
  return drained
}
