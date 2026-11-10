/**
 * One `runtime.onMessage` listener for the background, dispatching on `type`.
 *
 * Every other extension context (offscreen document, pages, content scripts)
 * receives the same messages, so a handler that gives `undefined` leaves the
 * answer to them: the offscreen document answers `MODEL_STATE_QUERY` itself
 * once it exists.
 */

/** One handler per message type; the message is untrusted, hence `Partial`. */
export type MessageHandlers<M extends { type: string }> = {
  [K in M["type"]]: (message: Partial<Extract<M, { type: K }>>, sender: Browser.runtime.MessageSender) => unknown
}

/**
 * Builds the listener. A handler returns its answer, a promise of it, or
 * `undefined` to send nothing from here. Return a promise only when the sender
 * waits for an answer: the channel stays open until it settles.
 *
 * Async answers go through `sendResponse` + `return true`, not a returned
 * promise: Chrome's `runtime.onMessage` docs do not date promise support, and
 * WXT ships no polyfill.
 */
export function createMessageRouter<M extends { type: string }>(handlers: MessageHandlers<M>) {
  const table = handlers as Record<string, (message: unknown, sender: Browser.runtime.MessageSender) => unknown>
  return (message: unknown, sender: Browser.runtime.MessageSender, sendResponse: (answer: unknown) => void): true | undefined => {
    const type = (message as { type?: unknown } | null | undefined)?.type
    if (typeof type !== "string" || !Object.hasOwn(table, type)) return
    const answer = table[type]!(message, sender)
    if (!(answer instanceof Promise)) {
      if (answer !== undefined) sendResponse(answer)
      return
    }
    void answer.then(
      (value) => { if (value !== undefined) sendResponse(value) },
      (error: unknown) => console.error("[orateur] message handler failed", type, error),
    )
    return true
  }
}
