import { detectLang } from "./detect-lang.ts"
import type { SupportedLang } from "./supertonic-lang.ts"

/** Keep paragraph indices aligned with displayed text in every reader. */
export function splitBlocks(text: string): string[] {
  return text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
}

/** Short, ambiguous blocks inherit nearby context, then the document language. */
export function resolveBlockLangs(blocks: readonly string[], docLang: SupportedLang): SupportedLang[] {
  const decided = blocks.map((block) => detectLang(block, null))
  const isIndecisive = (i: number) => i >= 0 && i < decided.length && decided[i] === null
  return decided.map((lang, i) => {
    if (lang) return lang
    for (let d = 1; d <= 2; d++) {
      if (decided[i + d]) return decided[i + d]!
    }
    if (isIndecisive(i - 1) || isIndecisive(i + 1)) {
      for (let d = 1; d <= 2; d++) {
        if (decided[i - d]) return decided[i - d]!
      }
    }
    return docLang
  })
}
