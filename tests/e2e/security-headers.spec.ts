import { expect, test } from "./fixtures"

test("pages refuse framing and send the security headers", async ({ page }) => {
  const response = await page.goto("/sign-in")
  expect(response?.ok()).toBe(true)
  const headers = response!.headers()
  const csp = headers["content-security-policy"]
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toContain("object-src 'none'")
  expect(headers["x-frame-options"]).toBe("DENY")
  expect(headers["x-content-type-options"]).toBe("nosniff")
  expect(headers["referrer-policy"]).toBe("no-referrer")

  // The policy must not block the app itself: the sign-in form still renders
  // and the browser reports no CSP violations.
  const violations: string[] = []
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text()))
      violations.push(message.text())
  })
  await page.reload()
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true })
  ).toBeVisible()
  expect(violations).toEqual([])
})
