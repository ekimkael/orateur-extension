/** Find the nearest speakable paragraph in the given direction. */
export function moveReadingBlock(current: number, total: number, delta: -1 | 1, hasSpeech?: (block: number) => boolean) {
  for (let target = current + delta; target >= 0 && target < total; target += delta) {
    if (!hasSpeech || hasSpeech(target)) return target
  }
  return null
}
