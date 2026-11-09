/** Bytes in whole MB, counted in 1024² like every size the options page shows. */
export function toMegabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024))
}
