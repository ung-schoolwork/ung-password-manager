import { beforeAll, beforeEach, describe, expect, it } from "bun:test"

import type {
  ExtensionRequest,
  ExtensionResponses,
} from "../../../extension/src/api"
import {
  PopupController,
  type PopupControllerOptions,
  type PopupView,
  type Send,
} from "../../../extension/src/popup-controller"
import {
  createWrappedVaultKey,
  decryptVault,
  deriveAccountKeys,
  encryptVault,
  unwrapVaultKey,
} from "../../../lib/vault/crypto.client"
import type { VaultDataV1, WrappedVaultKey } from "../../../lib/vault/types"

const email = "popup@example.test"
const password = "popup password 1234"
const wrongPassword = "not the password 1234"
const revision = "3f2b8c1e-7a4d-4e5f-9a1b-2c3d4e5f6a7b"
const credential = (
  id: string,
  accountName: string,
  username: string,
  siteOrApp = `${id}.example.test`
) => ({
  id,
  accountName,
  siteOrApp,
  username,
  password: `secret-${id}`,
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
  passwordUpdatedAt: "2026-11-05T00:00:00.000Z",
})
const data: VaultDataV1 = {
  version: 1,
  credentials: [
    credential("b", "University email", "student"),
    credential("a", "Bank", "student.bank"),
    credential(
      "c",
      "Course portal",
      "student.portal",
      "https://www.portal.example.test/login"
    ),
    credential("d", "Portal admin", "admin", "admin.portal.example.test"),
    credential("e", "Lookalike", "someone", "evil-portal.example.test"),
  ],
}

// PBKDF2 with 600,000 rounds is slow; derive each password once.
const derived = new Map<string, ReturnType<typeof deriveAccountKeys>>()
const deriveKeys: typeof deriveAccountKeys = (forEmail, forPassword) => {
  const key = `${forEmail}\n${forPassword}`
  if (!derived.has(key))
    derived.set(key, deriveAccountKeys(forEmail, forPassword))
  return derived.get(key)!
}

let authKey: string
let wrappedVaultKey: WrappedVaultKey
let envelope: Awaited<ReturnType<typeof encryptVault>>

beforeAll(async () => {
  const keys = await deriveKeys(email, password)
  authKey = keys.authKey
  wrappedVaultKey = await createWrappedVaultKey(keys.wrappingKey)
  envelope = await encryptVault(
    await unwrapVaultKey(keys.wrappingKey, wrappedVaultKey),
    data
  )
  await deriveKeys(email, wrongPassword)
})

/** The app's account state for this Chrome profile, as the server sees it. */
let server: {
  signedIn: boolean
  approved: boolean
  userId: string
  code: string
  revision: string | null
  envelope: typeof envelope | null
  /** Revisions saved by other devices before the next save arrives. */
  racingSaves: number
  vaultDownloads: number
  requests: ExtensionRequest["type"][]
}

beforeEach(() => {
  server = {
    signedIn: false,
    approved: false,
    userId: "user-1",
    code: "12345678",
    revision,
    envelope,
    racingSaves: 0,
    vaultDownloads: 0,
    requests: [],
  }
})

const send = (async (request: ExtensionRequest) => {
  server.requests.push(request.type)
  const answer = (): ExtensionResponses[ExtensionRequest["type"]] => {
    switch (request.type) {
      case "session":
        return server.signedIn
          ? { state: "signed-in", userId: server.userId, email }
          : { state: "signed-out" }
      case "sign-in":
        if (request.authKey !== authKey) return { state: "rejected" }
        server.signedIn = true
        return { state: "signed-in", userId: server.userId, email }
      case "sign-out":
        server.signedIn = false
        return { state: "signed-out" }
      case "device":
        if (!server.signedIn) return { state: "signed-out" }
        return server.approved
          ? { state: "approved" }
          : {
              state: "pending",
              code: server.code,
              expiresAt: "2026-11-05T10:00:00.000Z",
            }
      case "vault":
        if (!server.signedIn) return { state: "signed-out" }
        if (!server.approved) return { state: "not-approved" }
        server.vaultDownloads += 1
        return {
          state: "ok",
          snapshot: {
            wrappedVaultKey,
            envelope: server.envelope,
            revision: server.revision,
          },
        }
      case "revision":
        if (!server.signedIn) return { state: "signed-out" }
        if (!server.approved) return { state: "not-approved" }
        return { state: "ok", revision: server.revision }
      case "save-vault":
        if (!server.signedIn) return { state: "signed-out" }
        if (!server.approved) return { state: "not-approved" }
        if (server.racingSaves > 0) {
          server.racingSaves -= 1
          server.revision = crypto.randomUUID()
        }
        if (request.expectedRevision !== server.revision)
          return { state: "conflict" }
        server.envelope = request.envelope
        server.revision = crypto.randomUUID()
        return { state: "saved", revision: server.revision }
    }
  }
  await Promise.resolve()
  return answer()
}) as Send

function popup(
  tabUrl: string | null = null,
  options: Partial<PopupControllerOptions> = {}
) {
  const views: PopupView[] = []
  const controller = new PopupController({
    send,
    render: (view) => views.push(view),
    approvalPollMs: 5,
    vaultPollMs: 5,
    deriveKeys,
    tabUrl,
    ...options,
  })
  return { controller, views }
}

async function until(
  controller: PopupController,
  matches: (view: PopupView) => boolean
) {
  const deadline = Date.now() + 2_000
  while (!matches(controller.current)) {
    if (Date.now() > deadline)
      throw new Error(`Still showing ${JSON.stringify(controller.current)}`)
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  return controller.current
}

const shown = (name: PopupView["name"]) => (view: PopupView) =>
  view.name === name

describe("popup sign-in", () => {
  it("signs in, shows the approval code without any vault data, then opens the vault once approved", async () => {
    const { controller } = popup("https://a.example.test/sign-in")
    await controller.start()
    expect(controller.current).toEqual({
      name: "sign-in",
      error: null,
      busy: false,
    })

    await controller.signIn(email, wrongPassword)
    expect(controller.current).toEqual({
      name: "sign-in",
      error: "The email or password is incorrect.",
      busy: false,
    })

    await controller.signIn(email, password)
    expect(controller.current).toEqual({
      name: "approval",
      email,
      code: "12345678",
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(controller.current.name).toBe("approval")
    expect(server.vaultDownloads).toBe(0)

    // The password is not asked for again: the key from sign-in is kept
    // until the vault opens.
    server.approved = true
    const vault = await until(controller, shown("vault"))
    expect(vault).toEqual({
      name: "vault",
      email,
      site: "a.example.test",
      siteEntries: [
        {
          id: "a",
          accountName: "Bank",
          siteOrApp: "a.example.test",
          username: "student.bank",
        },
      ],
      query: "",
      results: null,
      total: 5,
      notice: null,
    })
    expect(JSON.stringify(vault)).not.toContain("secret-")
    controller.dispose()
  })

  it("unlocks with the password when the browser is already signed in and approved", async () => {
    server.signedIn = true
    server.approved = true
    const { controller } = popup()
    await controller.start()
    expect(controller.current).toEqual({
      name: "unlock",
      email,
      error: null,
      busy: false,
    })
    expect(server.requests).not.toContain("sign-in")

    await controller.unlock(wrongPassword)
    expect(controller.current).toMatchObject({
      name: "unlock",
      error: "The password is incorrect or the saved vault is damaged.",
    })

    await controller.unlock(password)
    expect(controller.current).toMatchObject({ name: "vault", email })
    expect(server.requests).not.toContain("sign-in")
    controller.dispose()
  })

  it("opens an account that has not saved a vault yet", async () => {
    server.signedIn = true
    server.approved = true
    server.revision = null
    // An empty vault has no envelope, so only the wrapped key is checked.
    server.envelope = null
    const { controller } = popup()
    await controller.start()
    await controller.unlock(password)
    expect(controller.current).toEqual({
      name: "vault",
      email,
      site: null,
      siteEntries: [],
      query: "",
      results: null,
      total: 0,
      notice: null,
    })
    controller.dispose()
  })
})

describe("popup vault access", () => {
  async function openVault() {
    server.signedIn = true
    server.approved = true
    const result = popup()
    await result.controller.start()
    await result.controller.unlock(password)
    expect(result.controller.current.name).toBe("vault")
    return result
  }

  it("hides the vault and shows a new approval code when this browser is removed", async () => {
    const { controller } = await openVault()
    server.approved = false
    server.code = "87654321"
    expect(await until(controller, shown("approval"))).toEqual({
      name: "approval",
      email,
      code: "87654321",
    })

    // Approved again, it needs the password again: the vault key is gone.
    server.approved = true
    expect(await until(controller, shown("unlock"))).toMatchObject({
      name: "unlock",
      email,
    })
    controller.dispose()
  })

  it("locks when the app signs the browser out", async () => {
    const { controller } = await openVault()
    server.signedIn = false
    expect(await until(controller, shown("sign-in"))).toEqual({
      name: "sign-in",
      error: "You were signed out.",
      busy: false,
    })
    controller.dispose()
  })

  it("starts over when the browser is signed in to another account", async () => {
    const { controller } = await openVault()
    server.userId = "user-2"
    expect(await until(controller, shown("unlock"))).toMatchObject({
      name: "unlock",
    })
    controller.dispose()
  })

  it("picks up changes saved on another device", async () => {
    const { controller } = await openVault()
    const downloads = server.vaultDownloads
    server.revision = "4f2b8c1e-7a4d-4e5f-9a1b-2c3d4e5f6a7b"
    await until(controller, () => server.vaultDownloads > downloads)
    await until(controller, shown("vault"))
    controller.dispose()
  })

  it("signs out the browser and forgets the vault", async () => {
    const { controller } = await openVault()
    await controller.signOut()
    expect(server.requests).toContain("sign-out")
    expect(server.signedIn).toBe(false)
    expect(controller.current).toEqual({
      name: "sign-in",
      error: null,
      busy: false,
    })

    // Signing in elsewhere afterwards still requires the password here.
    server.signedIn = true
    await controller.start()
    expect(controller.current.name).toBe("unlock")
    controller.dispose()
  })

  it("never shows a vault that was locked while it was loading", async () => {
    server.signedIn = true
    server.approved = true
    const { controller, views } = popup()
    await controller.start()
    const unlocking = controller.unlock(password)
    controller.lock()
    await unlocking
    expect(views.some((view) => view.name === "vault")).toBe(false)
    expect(controller.current.name).toBe("unlock")
    controller.dispose()
  })
})

describe("popup current site and search", () => {
  async function openVault(tabUrl: string | null) {
    server.signedIn = true
    server.approved = true
    const { controller } = popup(tabUrl)
    await controller.start()
    await controller.unlock(password)
    const view = controller.current
    if (view.name !== "vault") throw new Error(`Showing ${view.name}`)
    return { controller, view }
  }

  const ids = (entries: { id: string }[] | null) =>
    entries?.map(({ id }) => id) ?? null

  it("lists the logins saved for the current tab's site and its parent domains", async () => {
    const signIn = await openVault("https://sign-in.portal.example.test/x")
    expect(signIn.view.site).toBe("sign-in.portal.example.test")
    expect(ids(signIn.view.siteEntries)).toEqual(["c"])
    signIn.controller.dispose()

    const admin = await openVault("https://admin.portal.example.test/")
    expect(ids(admin.view.siteEntries)).toEqual(["c", "d"])
    admin.controller.dispose()

    // A lookalike site only gets its own login.
    const lookalike = await openVault("https://evil-portal.example.test/")
    expect(ids(lookalike.view.siteEntries)).toEqual(["e"])
    lookalike.controller.dispose()
  })

  it("has no site for browser pages and when the tab's address is unknown", async () => {
    for (const tabUrl of ["chrome://newtab/", "file:///tmp/a.html", null]) {
      const { controller, view } = await openVault(tabUrl)
      expect(view.site).toBeNull()
      expect(view.siteEntries).toEqual([])
      expect(view.total).toBe(5)
      controller.dispose()
    }
  })

  it("searches every login by account name, website, or username", async () => {
    const { controller } = await openVault("chrome://newtab/")
    const results = () =>
      controller.current.name === "vault"
        ? ids(controller.current.results)
        : "not shown"

    controller.search("STUDENT")
    expect(results()).toEqual(["a", "c", "b"])
    expect(controller.current).toMatchObject({ query: "STUDENT" })
    controller.search("portal admin")
    expect(results()).toEqual(["d"])
    controller.search("evil-portal")
    expect(results()).toEqual(["e"])
    controller.search("secret-")
    expect(results()).toEqual([])
    controller.search("   ")
    expect(results()).toBeNull()

    // Locking forgets the search along with the logins.
    controller.search("bank")
    controller.lock()
    controller.search("bank")
    expect(controller.current.name).toBe("unlock")
    await controller.unlock(password)
    expect(controller.current).toMatchObject({ query: "", results: null })
    controller.dispose()
  })
})

describe("popup fill", () => {
  const pageUrl = "https://admin.portal.example.test/login"
  let tab: { id: number; url: string | null } | null
  let filled: { tabId: number; login: unknown }[]
  let outcome: Awaited<ReturnType<PopupControllerOptions["fillPage"] & {}>>

  beforeEach(() => {
    tab = { id: 7, url: pageUrl }
    filled = []
    outcome = { username: true, password: true }
  })

  async function openVault() {
    server.signedIn = true
    server.approved = true
    const result = popup(pageUrl, {
      currentTab: async () => tab,
      fillPage: async (tabId, login) => {
        filled.push({ tabId, login })
        return outcome
      },
    })
    await result.controller.start()
    await result.controller.unlock(password)
    expect(result.controller.current.name).toBe("vault")
    return result
  }

  const notice = (controller: PopupController) =>
    controller.current.name === "vault" ? controller.current.notice : "hidden"

  it("fills nothing until a login is chosen, then only that login", async () => {
    const { controller, views } = await openVault()
    expect(filled).toEqual([])

    await controller.fill("c")
    expect(filled).toEqual([
      {
        tabId: 7,
        login: {
          username: "student.portal",
          password: "secret-c",
          siteOrApp: "https://www.portal.example.test/login",
        },
      },
    ])
    expect(notice(controller)).toEqual({
      text: "Filled your username and password.",
      tone: "info",
    })
    // The password went to the page, never into what the popup shows.
    expect(JSON.stringify(views)).not.toContain("secret-")
    controller.dispose()
  })

  it("checks the tab again when filling and refuses another site", async () => {
    const { controller } = await openVault()
    tab = { id: 7, url: "https://evil-portal.example.test/login" }
    await controller.fill("c")
    expect(filled).toEqual([])
    expect(notice(controller)).toEqual({
      text: "This login is for portal.example.test, not evil-portal.example.test, so it wasn't filled.",
      tone: "error",
    })
    controller.dispose()
  })

  it("refuses pages that are not secure or not websites", async () => {
    const { controller } = await openVault()
    const refused = {
      "http://admin.portal.example.test/login":
        "This page isn't secure, so the login wasn't filled.",
      "chrome://newtab/": "Logins can only be filled on websites.",
    }
    for (const [url, text] of Object.entries(refused)) {
      tab = { id: 7, url }
      await controller.fill("c")
      expect(notice(controller)).toEqual({ text, tone: "error" })
    }
    tab = null
    await controller.fill("c")
    expect(notice(controller)).toEqual({
      text: "Logins can only be filled on websites.",
      tone: "error",
    })
    expect(filled).toEqual([])
    controller.dispose()
  })

  it("says which fields were filled on each step of a two-step sign-in", async () => {
    const { controller } = await openVault()
    const cases: [typeof outcome, string, "info" | "error"][] = [
      [
        { username: true, password: false },
        "Filled your username. When the page asks for your password, open the extension and choose this login again.",
        "info",
      ],
      [{ username: false, password: true }, "Filled your password.", "info"],
      [
        { username: false, password: false },
        "No sign-in fields were found on this page.",
        "error",
      ],
      [
        { refused: true },
        "This page couldn't be filled. Open the extension from the page you want to sign in to.",
        "error",
      ],
      [
        null,
        "This page couldn't be filled. Open the extension from the page you want to sign in to.",
        "error",
      ],
    ]
    for (const [result, text, tone] of cases) {
      outcome = result
      await controller.fill("c")
      expect(notice(controller)).toEqual({ text, tone })
    }
    controller.dispose()
  })

  it("does not fill a login after the vault was locked", async () => {
    const { controller } = await openVault()
    let release: () => void = () => undefined
    const opened = popup(pageUrl, {
      currentTab: () =>
        new Promise((resolve) => {
          release = () => resolve(tab)
        }),
      fillPage: async (tabId, login) => {
        filled.push({ tabId, login })
        return outcome
      },
    })
    controller.dispose()
    await opened.controller.start()
    await opened.controller.unlock(password)
    const filling = opened.controller.fill("c")
    opened.controller.lock()
    release()
    await filling
    expect(filled).toEqual([])
    expect(opened.controller.current.name).toBe("unlock")
    // Locked, there is nothing to fill.
    await opened.controller.fill("c")
    expect(filled).toEqual([])
    opened.controller.dispose()
  })
})

describe("popup save", () => {
  const pageUrl = "https://www.new-site.example.test/sign-in"
  let page: Awaited<ReturnType<PopupControllerOptions["readPage"] & {}>>

  beforeEach(() => {
    page = { username: "new.student", password: "typed on the page 1" }
  })

  async function openVault(tabUrl: string | null = pageUrl) {
    server.signedIn = true
    server.approved = true
    const result = popup(tabUrl, {
      currentTab: async () => (tabUrl ? { id: 9, url: tabUrl } : null),
      readPage: async () => page,
    })
    await result.controller.start()
    await result.controller.unlock(password)
    expect(result.controller.current.name).toBe("vault")
    return result
  }

  async function savedCredentials() {
    const keys = await deriveKeys(email, password)
    const vaultKey = await unwrapVaultKey(keys.wrappingKey, wrappedVaultKey)
    return (await decryptVault(vaultKey, server.envelope!)).credentials
  }

  it("offers what was typed on the page and saves it as a login for the site", async () => {
    const { controller } = await openVault()
    await controller.startSave()
    expect(controller.current).toEqual({
      name: "save",
      email,
      draft: {
        accountName: "new-site.example.test",
        siteOrApp: "new-site.example.test",
        username: "new.student",
        password: "typed on the page 1",
      },
      errors: {},
      error: null,
      busy: false,
    })

    await controller.saveLogin({
      accountName: "New site",
      siteOrApp: "new-site.example.test",
      username: "new.student",
      password: "typed on the page 1",
    })
    const vault = controller.current
    expect(vault).toMatchObject({
      name: "vault",
      total: 6,
      notice: { text: "Saved New site.", tone: "info" },
      siteEntries: [
        {
          accountName: "New site",
          siteOrApp: "new-site.example.test",
          username: "new.student",
        },
      ],
    })
    // Only ciphertext reached the server, and it holds every login.
    const saved = await savedCredentials()
    expect(saved).toHaveLength(6)
    expect(saved[0]).toMatchObject({
      accountName: "New site",
      password: "typed on the page 1",
    })
    expect(JSON.stringify(vault)).not.toContain("typed on the page")
    controller.dispose()
  })

  it("starts empty when the page has no sign-in form or is not a website", async () => {
    page = { username: "", password: "" }
    const first = await openVault()
    await first.controller.startSave()
    expect(first.controller.current).toMatchObject({
      draft: { username: "", password: "" },
    })
    first.controller.dispose()

    const second = await openVault("chrome://newtab/")
    await second.controller.startSave()
    expect(second.controller.current).toMatchObject({
      draft: { accountName: "", siteOrApp: "", username: "", password: "" },
    })
    second.controller.cancelSave()
    expect(second.controller.current.name).toBe("vault")
    second.controller.dispose()
  })

  it("asks for missing fields and saves nothing", async () => {
    const { controller } = await openVault()
    await controller.startSave()
    const before = server.revision
    await controller.saveLogin({
      accountName: " ",
      siteOrApp: "new-site.example.test",
      username: "",
      password: "",
    })
    expect(controller.current).toMatchObject({
      name: "save",
      errors: {
        accountName: "Enter an account label.",
        username: "Enter a username.",
        password: "Enter a password.",
      },
    })
    expect(server.revision).toBe(before)
    controller.dispose()
  })

  it("adds the login to a vault saved meanwhile on another device", async () => {
    const { controller } = await openVault()
    await controller.startSave()
    server.racingSaves = 1
    await controller.saveLogin({
      accountName: "New site",
      siteOrApp: "new-site.example.test",
      username: "new.student",
      password: "typed on the page 1",
    })
    expect(controller.current).toMatchObject({ name: "vault", total: 6 })
    expect(await savedCredentials()).toHaveLength(6)

    // A vault that keeps changing is not overwritten; the form says so.
    await controller.startSave()
    server.racingSaves = 5
    const draft = {
      accountName: "Another",
      siteOrApp: "new-site.example.test",
      username: "other",
      password: "another password 1",
    }
    await controller.saveLogin(draft)
    expect(controller.current).toMatchObject({
      name: "save",
      draft,
      error:
        "Your vault is changing on another device. Wait a moment, then save again.",
      busy: false,
    })
    controller.dispose()
  })

  it("signs out instead of saving when the session has ended", async () => {
    const { controller } = await openVault()
    await controller.startSave()
    server.signedIn = false
    await controller.saveLogin({
      accountName: "New site",
      siteOrApp: "new-site.example.test",
      username: "new.student",
      password: "typed on the page 1",
    })
    expect(controller.current).toEqual({
      name: "sign-in",
      error: "You were signed out.",
      busy: false,
    })
    controller.dispose()
  })
})
