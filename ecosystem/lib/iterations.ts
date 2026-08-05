// Iteration counts are fixed rather than time-budgeted so that two runs on the
// same machine are comparable, and so a slow side cannot quietly get fewer
// samples than a fast one. They fall as coverage rises because a 1000x parse is
// two orders of magnitude more work than a 20x one.
export function iterations(label: string) {
  if (label.startsWith('1000x')) {
    return { iterations: 5, warmupIterations: 2 }
  }
  if (label.startsWith('200x')) {
    return { iterations: 10, warmupIterations: 3 }
  }
  return { iterations: 20, warmupIterations: 5 }
}
