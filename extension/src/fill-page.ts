// Injected into the current tab's top frame, in the extension's isolated
// world, only when the user chooses a login in the popup. It defines one
// function; the popup then calls it with the chosen login. The login is never
// kept here: it exists only as that call's arguments.

import { fillProblem } from "@/lib/vault/site-match"

import { isShown, pickLoginFields, type FieldInfo } from "./fill-fields"

export type FillOutcome =
  { refused: true } | { username: boolean; password: boolean }

function hints(input: HTMLInputElement) {
  const labels = Array.from(input.labels ?? [], (label) => label.textContent)
  return [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute("aria-label"),
    ...labels,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function describe(
  input: HTMLInputElement,
  page: { width: number; height: number }
): FieldInfo {
  const rect = input.getBoundingClientRect()
  const style = getComputedStyle(input)
  const visible =
    (input.checkVisibility?.({
      opacityProperty: true,
      visibilityProperty: true,
    }) ??
      true) &&
    isShown(
      {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
      },
      style,
      page
    )
  return {
    type: (input.getAttribute("type") ?? "").toLowerCase(),
    autocomplete: (input.getAttribute("autocomplete") ?? "").toLowerCase(),
    hints: hints(input),
    visible,
    editable: !input.disabled && !input.readOnly,
  }
}

// Sets the value the way typing does, so pages built with frameworks that
// track input values (React and others) see the change.
function enter(input: HTMLInputElement, value: string) {
  input.focus()
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set
  if (setValue) setValue.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

function fillLogin(
  username: string,
  password: string,
  siteOrApp: string
): FillOutcome {
  // Checked again here, at the moment of filling, in case the tab moved on.
  if (window.top !== window || fillProblem(location.href, siteOrApp))
    return { refused: true }
  const root = document.documentElement
  const page = {
    width: Math.max(root.scrollWidth, window.innerWidth),
    height: Math.max(root.scrollHeight, window.innerHeight),
  }
  const inputs = Array.from(document.querySelectorAll("input"))
  const picked = pickLoginFields(inputs.map((input) => describe(input, page)))
  const filled = { username: false, password: false }
  if (picked.username !== null && username) {
    enter(inputs[picked.username], username)
    filled.username = true
  }
  if (picked.password !== null && password) {
    enter(inputs[picked.password], password)
    filled.password = true
  }
  return filled
}

;(
  globalThis as { ungPasswordManagerFill?: typeof fillLogin }
).ungPasswordManagerFill = fillLogin
