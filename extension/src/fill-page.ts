// Injected into the current tab's top frame, in the extension's isolated
// world, only when the user acts in the popup: choosing a login to fill it, or
// saving a login, which reads what the user typed into the page's sign-in
// form. It defines two functions that the popup then calls. Nothing is kept
// here: a login exists only as a call's arguments or its return value.

import { fillProblem } from "@/lib/vault/site-match"

import { isShown, pickLoginFields, type FieldInfo } from "./fill-fields"

export type FillOutcome =
  { refused: true } | { username: boolean; password: boolean }

/** What the user typed into the page's sign-in fields, empty when none. */
export type PageLogin =
  { refused: true } | { username: string; password: string }

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

function pageInputs() {
  const root = document.documentElement
  const page = {
    width: Math.max(root.scrollWidth, window.innerWidth),
    height: Math.max(root.scrollHeight, window.innerHeight),
  }
  const inputs = Array.from(document.querySelectorAll("input"))
  return { inputs, fields: inputs.map((input) => describe(input, page)) }
}

function fillLogin(
  username: string,
  password: string,
  siteOrApp: string
): FillOutcome {
  // Checked again here, at the moment of filling, in case the tab moved on.
  if (window.top !== window || fillProblem(location.href, siteOrApp))
    return { refused: true }
  const { inputs, fields } = pageInputs()
  const picked = pickLoginFields(fields)
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

// Reads the sign-in fields so the popup can offer to save them. Only websites
// are read, and only the top frame, as for filling.
function readLogin(): PageLogin {
  if (window.top !== window || !/^https?:$/.test(location.protocol))
    return { refused: true }
  const { inputs, fields } = pageInputs()
  const picked = pickLoginFields(fields, { forSaving: true })
  return {
    username:
      picked.username === null ? "" : inputs[picked.username].value.trim(),
    password: picked.password === null ? "" : inputs[picked.password].value,
  }
}

const exposed = globalThis as {
  ungPasswordManagerFill?: typeof fillLogin
  ungPasswordManagerRead?: typeof readLogin
}
exposed.ungPasswordManagerFill = fillLogin
exposed.ungPasswordManagerRead = readLogin
