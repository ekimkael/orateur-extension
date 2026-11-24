import { resolveDocLang } from "./detect-lang.ts"
import type { Player, PlayerOptions } from "./player.ts"
import { toPocketLanguage, type PocketLanguage, type PocketVoice } from "./pocket/catalog.ts"
import { KALE_VOICES, type KaleVoice } from "./kale/catalog.ts"
import { NOTIFY, type NotifyMessage } from "./reader-messages.ts"
import type { ReaderPreferences } from "./reader-prefs.ts"
import { createKalePlayer, createPocketPlayer, createSupertonicPlayer } from "./local-player.ts"
import type { SupportedLang } from "./supertonic-lang.ts"
import { createSystemPlayer } from "./system-player.ts"
import { MODEL_CACHE_QUERY, type ModelCacheQueryMessage } from "./tts-messages.ts"

/** The engine actually used for one reading, independent of the saved preference. */
export type PlayerSelection =
  | { engine: "system"; lang?: string }
  | { engine: "supertonic"; lang: SupportedLang }
  | { engine: "pocket"; lang: PocketLanguage; voice: PocketVoice; cacheOnly: boolean }
  | { engine: "kale"; lang: "en"; voice: KaleVoice; cacheOnly: boolean; webGpu: boolean }

/** Resolve language and private-window availability before loading engine-specific settings. */
export async function selectPlayer(
  { engine, pocketVoice, kaleVoice, kaleWebGpu = false }: ReaderPreferences, declared: string | undefined, text: string,
): Promise<PlayerSelection> {
  const system = { engine: "system", lang: declared } as const
  if (engine === "system") return system

  const lang = resolveDocLang(declared, text)
  const cacheOnly = browser.extension.inIncognitoContext
  if (engine === "kale") {
    const voice = kaleVoice ?? KALE_VOICES[0].id
    const cached = !cacheOnly || (lang === "en" && await browser.runtime.sendMessage({
      type: MODEL_CACHE_QUERY, engine, lang, voice,
    } satisfies ModelCacheQueryMessage).catch(() => false))
    if (lang === "en" && cached) return { engine, lang, voice, cacheOnly, webGpu: kaleWebGpu }
    void browser.runtime.sendMessage({
      type: NOTIFY, message: browser.i18n.getMessage(lang === "en" ? "noticeKalePrivateWindow" : "noticeKaleLangUnsupported"),
    } satisfies NotifyMessage).catch(() => {})
    return system
  }
  const pocketLang = lang && toPocketLanguage(lang)
  const supported = engine === "pocket" ? pocketLang : lang
  const cached = !cacheOnly || (supported &&
    await browser.runtime.sendMessage({
      type: MODEL_CACHE_QUERY, engine, lang: supported, voice: engine === "pocket" ? pocketVoice : undefined,
    } satisfies ModelCacheQueryMessage).catch(() => false))
  if (cached) {
    if (engine === "pocket" && pocketLang) return { engine, lang: pocketLang, voice: pocketVoice, cacheOnly }
    if (engine === "supertonic" && lang) return { engine, lang }
  }

  const key = engine === "pocket"
    ? supported ? "noticePocketPrivateWindow" : "noticePocketLangUnsupported"
    : supported ? "noticeSupertonicPrivateWindow" : "noticeSupertonicLangUnsupported"
  void browser.runtime.sendMessage({
    type: NOTIFY, message: browser.i18n.getMessage(key),
  } satisfies NotifyMessage).catch(() => {})
  return system
}

/** Construct the chosen strategy without starting audio or loading a model. */
export function createPlayer(selection: PlayerSelection, options: PlayerOptions, token: string): Player {
  switch (selection.engine) {
    case "system": return createSystemPlayer({ ...options, lang: selection.lang })
    case "supertonic": return createSupertonicPlayer({ ...options, lang: selection.lang, token })
    case "pocket": return createPocketPlayer({
      ...options, lang: selection.lang, token, voice: selection.voice, cacheOnly: selection.cacheOnly,
    })
    case "kale": return createKalePlayer({ ...options, ...selection, token })
  }
}
