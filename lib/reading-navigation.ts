export function moveReadingBlock(current: number, total: number, delta: -1 | 1) {
  const target = current + delta
  return target >= 0 && target < total ? target : null
}
