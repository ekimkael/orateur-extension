import assert from "node:assert/strict"
import test from "node:test"
import { isPasswordField, selectedFieldText } from "./selection-field.ts"

test("password selection never reads the field value", () => {
  const field = {
    tagName: "INPUT", type: "password", selectionStart: 0, selectionEnd: 6,
    get value() { throw new Error("Password value was read") },
  } as unknown as HTMLInputElement
  assert.equal(isPasswordField(field), true)
  assert.equal(selectedFieldText(field), null)
})

test("text inputs and textareas keep their selected text", () => {
  for (const tagName of ["INPUT", "TEXTAREA"]) {
    const field = { tagName, type: "text", value: "hello world", selectionStart: 6, selectionEnd: 11 } as HTMLInputElement
    assert.equal(isPasswordField(field), false)
    assert.equal(selectedFieldText(field), "world")
    field.selectionEnd = 6
    assert.equal(selectedFieldText(field), null)
  }
  assert.equal(isPasswordField(null), false)
})
