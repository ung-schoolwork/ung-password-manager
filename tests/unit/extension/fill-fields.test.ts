import { describe, expect, it } from "bun:test"

import {
  isShown,
  pickLoginFields,
  type FieldInfo,
} from "../../../extension/src/fill-fields"

function field(type: string, patch: Partial<FieldInfo> = {}): FieldInfo {
  return {
    type,
    autocomplete: "",
    hints: "",
    visible: true,
    editable: true,
    ...patch,
  }
}

describe("pickLoginFields", () => {
  it("picks the username and password of a sign-in form", () => {
    expect(
      pickLoginFields([
        field("search", { hints: "search" }),
        field("email", { autocomplete: "username" }),
        field("password", { autocomplete: "current-password" }),
        field("checkbox", { hints: "remember me" }),
      ])
    ).toEqual({ username: 1, password: 2 })
  })

  it("uses the text field just before the password when nothing is labelled", () => {
    expect(
      pickLoginFields([
        field("text", { hints: "newsletter" }),
        field("text"),
        field("password"),
      ])
    ).toEqual({ username: 1, password: 2 })
    // An input without a type attribute is a text input.
    expect(pickLoginFields([field(""), field("password")])).toEqual({
      username: 0,
      password: 1,
    })
  })

  it("skips hidden, off-screen, disabled, and read-only fields", () => {
    expect(
      pickLoginFields([
        field("text", { autocomplete: "username", visible: false }),
        field("password", { visible: false }),
        field("email", { autocomplete: "username" }),
        field("password", { editable: false }),
        field("password", { autocomplete: "current-password" }),
      ])
    ).toEqual({ username: 2, password: 4 })
    expect(
      pickLoginFields([
        field("email", { visible: false }),
        field("password", { visible: false }),
      ])
    ).toEqual({ username: null, password: null })
  })

  it("fills only the username on the first step of a two-step sign-in", () => {
    expect(
      pickLoginFields([
        field("email", { hints: "email" }),
        field("password", { visible: false }),
      ])
    ).toEqual({ username: 0, password: null })
    expect(
      pickLoginFields([field("text", { hints: "identifier phone or email" })])
    ).toEqual({ username: 0, password: null })
    expect(
      pickLoginFields([field("text", { autocomplete: "username" })])
    ).toEqual({ username: 0, password: null })
  })

  it("fills only the password on the second step", () => {
    expect(
      pickLoginFields([
        field("email", { autocomplete: "username", visible: false }),
        field("password", { autocomplete: "current-password" }),
      ])
    ).toEqual({ username: null, password: 1 })
  })

  it("does not fill a text field without a sign that it asks for the username", () => {
    expect(
      pickLoginFields([field("text", { hints: "search the site" })])
    ).toEqual({ username: null, password: null })
    expect(
      pickLoginFields([
        field("text", { autocomplete: "one-time-code", hints: "login code" }),
      ])
    ).toEqual({ username: null, password: null })
  })

  it("does not fill the password on forms that choose a new password", () => {
    expect(
      pickLoginFields([
        field("email", { autocomplete: "username" }),
        field("password", { autocomplete: "new-password" }),
        field("password", { autocomplete: "new-password" }),
      ])
    ).toEqual({ username: 0, password: null })
  })

  it("prefers the current-password field on a page that also changes passwords", () => {
    expect(
      pickLoginFields([
        field("password", { autocomplete: "new-password" }),
        field("text", { autocomplete: "username" }),
        field("password", { autocomplete: "current-password" }),
      ])
    ).toEqual({ username: 1, password: 2 })
  })
})

describe("isShown", () => {
  const page = { width: 1280, height: 2000 }
  const box = { top: 100, left: 100, width: 200, height: 30 }
  const look = { display: "block", visibility: "visible", opacity: "1" }

  it("accepts a field on the page, including below the fold", () => {
    expect(isShown(box, look, page)).toBe(true)
    expect(isShown({ ...box, top: 1900 }, look, page)).toBe(true)
  })

  it("rejects hidden, transparent, and zero-sized fields", () => {
    expect(isShown(box, { ...look, display: "none" }, page)).toBe(false)
    expect(isShown(box, { ...look, visibility: "hidden" }, page)).toBe(false)
    expect(isShown(box, { ...look, opacity: "0" }, page)).toBe(false)
    expect(isShown({ ...box, width: 0 }, look, page)).toBe(false)
    expect(isShown({ ...box, height: 0 }, look, page)).toBe(false)
  })

  it("rejects fields moved off the page", () => {
    expect(isShown({ ...box, left: -9999 }, look, page)).toBe(false)
    expect(isShown({ ...box, top: -500 }, look, page)).toBe(false)
    expect(isShown({ ...box, left: 5000 }, look, page)).toBe(false)
    expect(isShown({ ...box, top: 5000 }, look, page)).toBe(false)
  })
})
