export function isPasswordField(element: Element | null): boolean {
  return element?.tagName === "INPUT" && (element as HTMLInputElement).type === "password"
}

export function selectedFieldText(element: HTMLInputElement | HTMLTextAreaElement): string | null {
  if (isPasswordField(element)) return null
  const { selectionStart, selectionEnd } = element
  if (selectionStart === null || selectionEnd === null || selectionStart === selectionEnd) return null
  return element.value.slice(selectionStart, selectionEnd)
}
