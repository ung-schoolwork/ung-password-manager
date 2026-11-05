import type { Page } from "@playwright/test"

import { expect, test } from "./fixtures"
import { registerAccount, unlockVault } from "./account-helpers"
import { CLIPBOARD_CLEAR_MS } from "./clipboard-clear-timing"

const credentialPassword = "OriginalDemo!123456"

// Shared with playwright.config.ts through clipboard-clear-timing.ts, so the
// delay the app runs with and the deadline the tests wait for cannot drift.
const SAFETY_MARGIN_MS = 1000

// The second copy in the stale-timer test lands just past this share of the
// delay, leaving the first deadline and the second one on either side of the
// assertion.
const SECOND_COPY_FRACTION = 0.65
const FIRST_DEADLINE_MARGIN_MS = 400

test.beforeEach(async ({ page }) => {
  await registerAccount(page)
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
})

async function createVaultWithCredential(
  page: Page,
  password = credentialPassword
) {
  await page.goto("/")
  await unlockVault(page)

  await page.getByLabel("Account label").fill("University email")
  await page.getByLabel("Website or app").fill("mail.example.edu")
  await page.getByLabel("Username").fill("student@example.edu")
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Save credential" }).click()
  await expect(
    page.getByText("University email", { exact: true })
  ).toBeVisible()
}

function readClipboard(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText())
}

async function copyPassword(page: Page, expected = credentialPassword) {
  const savedCredential = page
    .getByRole("list", { name: "Saved credentials" })
    .getByRole("listitem")

  await savedCredential.getByRole("button", { name: "Copy password" }).click()
  await expect(savedCredential.getByRole("status")).toHaveText(
    "Password copied."
  )
  expect(await readClipboard(page)).toBe(expected)
}

async function waitUntil(page: Page, timestamp: number) {
  const remaining = timestamp - Date.now()
  if (remaining > 0) await page.waitForTimeout(remaining)
}

test("clears the clipboard after the timer when the user locks the vault", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)

  await page.getByRole("button", { name: "Lock vault" }).click()
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()

  await expect
    .poll(() => readClipboard(page), {
      timeout: CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS * 2,
    })
    .toBe("")
})

test("clears the clipboard after the timer when the user signs out", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)

  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()

  await expect
    .poll(() => readClipboard(page), {
      timeout: CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS * 2,
    })
    .toBe("")
})

test("clears the clipboard after the timer when the user opens Edit", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)

  await page.getByRole("button", { name: "Edit University email" }).click()
  await expect(
    page.getByRole("dialog", { name: "Edit credential" })
  ).toBeVisible()

  await expect
    .poll(() => readClipboard(page), {
      timeout: CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS * 2,
    })
    .toBe("")
})

test("clears the clipboard after the timer when the user leaves the vault page", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)

  await page.getByRole("link", { name: "Generator" }).click()
  await expect(page).toHaveURL(/\/generate$/)

  await expect
    .poll(() => readClipboard(page), {
      timeout: CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS * 2,
    })
    .toBe("")
})

test("clears the clipboard on the second deadline when the same password is copied again", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)
  const firstCopiedAt = Date.now()

  // Leave the copy buttons the way the ticket's Edit flow does, then copy the
  // same password from the freshly mounted instance.
  await page.getByRole("button", { name: "Edit University email" }).click()
  await expect(
    page.getByRole("dialog", { name: "Edit credential" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(
    page.getByRole("dialog", { name: "Edit credential" })
  ).toBeHidden()

  await waitUntil(
    page,
    firstCopiedAt + CLIPBOARD_CLEAR_MS * SECOND_COPY_FRACTION
  )
  await copyPassword(page)

  // Past the first timer's deadline, before the second one is due.
  await waitUntil(
    page,
    firstCopiedAt + CLIPBOARD_CLEAR_MS + FIRST_DEADLINE_MARGIN_MS
  )
  expect(await readClipboard(page)).toBe(credentialPassword)

  await expect
    .poll(() => readClipboard(page), {
      timeout: CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS,
    })
    .toBe("")
})

test("leaves the clipboard alone if it no longer holds the copied value", async ({
  page,
}) => {
  await createVaultWithCredential(page)
  await copyPassword(page)

  // Simulate the user copying something else before our timer fires.
  await page.evaluate(() =>
    navigator.clipboard.writeText("something-else-entirely")
  )

  await page.getByRole("button", { name: "Lock vault" }).click()
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()

  await page.waitForTimeout(CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS)
  expect(await readClipboard(page)).toBe("something-else-entirely")
})

// The generator sits behind the vault, so open it and reach the page through
// the nav like a user would (the unlocked vault survives the client-side
// navigation).
async function openGenerator(page: Page) {
  await page.goto("/")
  await unlockVault(page)

  // An empty vault opens the add dialog; close it to reach the navigation.
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(
    page.getByRole("dialog", { name: "Add a credential" })
  ).toBeHidden()

  await page.getByRole("link", { name: "Generator" }).click()
  await expect(page).toHaveURL(/\/generate$/)
}

// The Copy button on the generator page uses the same auto-clear as the saved
// credentials (SCRUM-63). Its label flips to "Copied" for two seconds, so the
// locator accepts both.
async function copyGeneratedPassword(page: Page) {
  const copyButton = page.getByRole("button", {
    name: /^(Copy password|Copied)$/,
  })
  await expect(copyButton).toBeEnabled()
  await copyButton.click()
  await expect.poll(() => readClipboard(page)).not.toBe("")
  return readClipboard(page)
}

test("clears a password copied from the generator after the timer", async ({
  page,
}) => {
  await openGenerator(page)
  await copyGeneratedPassword(page)

  await expect
    .poll(() => readClipboard(page), {
      timeout: CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS * 2,
    })
    .toBe("")
})

test("clears a generator password on the second deadline when it is copied again", async ({
  page,
}) => {
  await openGenerator(page)
  await copyGeneratedPassword(page)
  const firstCopiedAt = Date.now()

  await waitUntil(
    page,
    firstCopiedAt + CLIPBOARD_CLEAR_MS * SECOND_COPY_FRACTION
  )
  const copiedAgain = await copyGeneratedPassword(page)

  // Past the first timer's deadline, before the second one is due.
  await waitUntil(
    page,
    firstCopiedAt + CLIPBOARD_CLEAR_MS + FIRST_DEADLINE_MARGIN_MS
  )
  expect(await readClipboard(page)).toBe(copiedAgain)

  await expect
    .poll(() => readClipboard(page), {
      timeout: CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS,
    })
    .toBe("")
})

test("leaves a generator password alone if the clipboard no longer holds it", async ({
  page,
}) => {
  await openGenerator(page)
  await copyGeneratedPassword(page)

  // Simulate the user copying something else before our timer fires.
  await page.evaluate(() =>
    navigator.clipboard.writeText("something-else-entirely")
  )

  await page.waitForTimeout(CLIPBOARD_CLEAR_MS + SAFETY_MARGIN_MS)
  expect(await readClipboard(page)).toBe("something-else-entirely")
})

// Takes a V8 heap snapshot (Chromium only) and returns its JSON text.
async function takeHeapSnapshot(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send("HeapProfiler.enable")
    await cdp.send("HeapProfiler.collectGarbage")
    let snapshot = ""
    cdp.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => {
      snapshot += chunk
    })
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false })
    return snapshot
  } finally {
    await cdp.detach()
  }
}

// Reports whether `text` appears anywhere in a heap snapshot.
async function heapContains(page: Page, text: string) {
  const snapshot = await takeHeapSnapshot(page)
  // The snapshot is JSON, so look for the escaped form of the text.
  return snapshot.includes(JSON.stringify(text).slice(1, -1))
}

interface HeapSnapshot {
  snapshot: {
    meta: {
      node_fields: string[]
      node_types: [string[], ...unknown[]]
      edge_fields: string[]
      edge_types: [string[], ...unknown[]]
    }
  }
  nodes: number[]
  edges: number[]
  strings: string[]
}

// Reports whether the timers held by holdClearTimer can reach `text` on their
// own. The decrypted vault (and React's bookkeeping in development) can keep a
// password in the heap for a while after locking, so "is it anywhere in the
// heap" cannot tell whether the pending clear is what keeps it. Instead, walk
// what the timers reference, stopping at the page's global object and the
// DOM, through which everything on the page is reachable.
async function heldClearTimersReach(page: Page, text: string) {
  const snapshot = JSON.parse(await takeHeapSnapshot(page)) as HeapSnapshot
  const { meta } = snapshot.snapshot
  const { nodes, edges, strings } = snapshot
  const nodeFields = meta.node_fields.length
  const edgeFields = meta.edge_fields.length
  const nodeTypeField = meta.node_fields.indexOf("type")
  const nodeNameField = meta.node_fields.indexOf("name")
  const edgeCountField = meta.node_fields.indexOf("edge_count")
  const edgeTypeField = meta.edge_fields.indexOf("type")
  const edgeNameField = meta.edge_fields.indexOf("name_or_index")
  const edgeToField = meta.edge_fields.indexOf("to_node")
  const nodeCount = nodes.length / nodeFields

  const firstEdge = new Uint32Array(nodeCount + 1)
  for (let node = 0; node < nodeCount; node++) {
    firstEdge[node + 1] =
      firstEdge[node] + nodes[node * nodeFields + edgeCountField] * edgeFields
  }
  const typeOf = (node: number) =>
    meta.node_types[0][nodes[node * nodeFields + nodeTypeField]]
  const nameOf = (node: number) =>
    strings[nodes[node * nodeFields + nodeNameField]]
  function* strongEdges(node: number) {
    for (
      let edge = firstEdge[node];
      edge < firstEdge[node + 1];
      edge += edgeFields
    ) {
      const type = meta.edge_types[0][edges[edge + edgeTypeField]]
      if (type === "weak") continue
      yield {
        type,
        name: edges[edge + edgeNameField],
        to: edges[edge + edgeToField] / nodeFields,
      }
    }
  }

  const timers: number[] = []
  for (let node = 0; node < nodeCount; node++) {
    for (const edge of strongEdges(node)) {
      if (edge.type !== "property") continue
      if (strings[edge.name] !== "__heldClearTimers") continue
      for (const element of strongEdges(edge.to)) {
        if (element.type === "element") timers.push(element.to)
      }
    }
  }
  expect(
    timers.length,
    "a held clear timer is in the snapshot"
  ).toBeGreaterThan(0)

  const seen = new Set(timers)
  const queue = [...timers]
  while (queue.length > 0) {
    const node = queue.pop()!
    const type = typeOf(node)
    const name = nameOf(node)
    if (type.includes("string") && name.includes(text)) return true
    if (
      type === "native" ||
      type === "synthetic" ||
      name.startsWith("system / NativeContext") ||
      name.startsWith("Window")
    ) {
      continue
    }
    for (const edge of strongEdges(node)) {
      if (seen.has(edge.to)) continue
      seen.add(edge.to)
      queue.push(edge.to)
    }
  }
  return false
}

// Holds the auto-clear timer instead of letting it fire, so the pending clear
// is still alive (like a real one for up to the clear delay) while the heap is
// inspected. The handler is kept, as a real timer would keep it, in an array
// heldClearTimersReach can find by name.
async function holdClearTimer(page: Page) {
  await page.addInitScript((clearMs: number) => {
    const realSetTimeout = window.setTimeout.bind(window)
    const held: unknown[] = []
    Object.defineProperty(window, "__heldClearTimers", { value: held })
    window.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (timeout === clearMs) {
        held.push(handler)
        return 0
      }
      return realSetTimeout(handler, timeout, ...args)
    }) as unknown as typeof window.setTimeout
  }, CLIPBOARD_CLEAR_MS)
}

test("the pending clear keeps no plaintext copy of the copied password in memory", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await holdClearTimer(page)

  await openGenerator(page)
  const copied = await copyGeneratedPassword(page)

  // Control: while the generator is on screen the snapshot does see the
  // password, so a clean snapshot below means something.
  expect(await heapContains(page, copied)).toBe(true)

  // Leave the generator without reloading, so its own state is gone and only
  // the pending clear could still reference the password.
  await page.goBack()
  // The empty vault reopens its add dialog, which hides the rest of the page
  // from the accessibility tree, hence includeHidden.
  await expect(
    page.getByRole("button", { name: "Lock vault", includeHidden: true })
  ).toBeVisible()

  expect(await heapContains(page, copied)).toBe(false)
})

test("the pending clear of a saved password does not keep it in memory after locking", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await holdClearTimer(page)

  // A fresh password per run, so nothing left over from another test can
  // account for a match.
  const password = `Heap!${crypto.randomUUID()}`
  await createVaultWithCredential(page, password)
  await copyPassword(page, password)

  // Control: while the copy buttons are on screen, the clear timer reaches
  // their props, so the walk does find the password when it is there.
  expect(await heldClearTimersReach(page, password)).toBe(true)

  // Locking unmounts the copy buttons; the pending clear must not be what
  // keeps the password alive from here on.
  await page.getByRole("button", { name: "Lock vault" }).click()
  await expect(
    page.getByRole("heading", { name: "Unlock your vault" })
  ).toBeVisible()

  expect(await heldClearTimersReach(page, password)).toBe(false)
})
