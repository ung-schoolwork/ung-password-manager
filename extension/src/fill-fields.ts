// Chooses which inputs on a page receive a saved login. Pure, so it can be
// tested without a browser; extension/src/fill-page.ts describes the page's
// inputs and applies the result.

/** What the picker needs to know about one <input>, in document order. */
export interface FieldInfo {
  /** The input's type, lowercase ("text", "email", "password", ...). */
  type: string
  /** The autocomplete attribute, lowercase. */
  autocomplete: string
  /** The name, id, placeholder, and label text, lowercase. */
  hints: string
  /** Shown on the page: not hidden, transparent, zero-sized, or off-screen. */
  visible: boolean
  /** Neither disabled nor read-only. */
  editable: boolean
}

/** Indexes into the described inputs, or null when there is no such field. */
export interface LoginFields {
  username: number | null
  password: number | null
}

const TEXT_TYPES = new Set(["text", "email", "tel", ""])
const USERNAME_HINT = /user|e-?mail|login|account|identif|sign.?in/

function tokens(autocomplete: string) {
  return autocomplete.split(/\s+/).filter(Boolean)
}

/**
 * Picks the username and password fields of a sign-in form. Only visible,
 * editable inputs are considered. When a page shows only one of the two (a
 * login split over two steps), only that one is picked.
 *
 * With `forSaving`, the fields are read to save a login rather than filled:
 * a new password (sign-up, password change) is then the one worth saving, so
 * it is preferred over the current one.
 */
export function pickLoginFields(
  fields: FieldInfo[],
  { forSaving = false }: { forSaving?: boolean } = {}
): LoginFields {
  const usable = fields
    .map((field, index) => ({
      ...field,
      index,
      tokens: tokens(field.autocomplete),
    }))
    .filter((field) => field.visible && field.editable)

  // A form for choosing a new password (sign-up, password change) is not a
  // sign-in, so only a password field that is not a new one is filled.
  const passwordFields = usable.filter((field) => field.type === "password")
  const newPassword = passwordFields.find((field) =>
    field.tokens.includes("new-password")
  )
  const passwords = passwordFields.filter(
    (field) => !field.tokens.includes("new-password")
  )
  const password =
    (forSaving ? newPassword : undefined) ??
    passwords.find((field) => field.tokens.includes("current-password")) ??
    passwords[0] ??
    null

  const texts = usable.filter(
    (field) =>
      TEXT_TYPES.has(field.type) && !field.tokens.includes("one-time-code")
  )
  const before = password
    ? texts.filter((field) => field.index < password.index)
    : texts
  const declared = before.filter(
    (field) =>
      field.tokens.includes("username") || field.tokens.includes("email")
  )
  let username = declared.at(password ? -1 : 0) ?? null
  if (!username && password) {
    // The text field closest before the password field.
    username = before.at(-1) ?? null
  } else if (!username) {
    // A first step that asks only for the username: require a clear sign.
    username =
      texts.find(
        (field) => field.type === "email" || USERNAME_HINT.test(field.hints)
      ) ?? null
  }

  return {
    username: username?.index ?? null,
    password: password?.index ?? null,
  }
}

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

export interface Look {
  display: string
  visibility: string
  opacity: string
}

/**
 * Whether an input is really shown to the user. `box` is in page coordinates
 * (scroll offsets included) and `page` is the size of the whole page; fields
 * placed outside it, such as a hidden trap moved far to the left, are not.
 */
export function isShown(
  box: Box,
  look: Look,
  page: { width: number; height: number }
): boolean {
  if (look.display === "none") return false
  if (look.visibility === "hidden" || look.visibility === "collapse")
    return false
  if (Number.parseFloat(look.opacity) === 0) return false
  if (box.width < 1 || box.height < 1) return false
  return (
    box.left + box.width > 0 &&
    box.top + box.height > 0 &&
    box.left < page.width &&
    box.top < page.height
  )
}
