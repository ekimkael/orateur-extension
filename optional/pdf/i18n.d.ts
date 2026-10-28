import "wxt/browser"
import type messages from "./locales/en/messages.json"

// Available only in the companion's generated catalog, even after a main build regenerates WXT types.
declare module "wxt/browser" {
  interface WxtI18n {
    getMessage(messageName: keyof typeof messages, substitutions?: string | string[]): string
  }
}
