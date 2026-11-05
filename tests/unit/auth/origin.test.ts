import { describe, expect, it } from "bun:test"

import { extensionOrigins, isAllowedOrigin } from "../../../lib/auth/origin"

const app = "https://app.example.test"
const extension = "chrome-extension://ibfocpogcdoolfmhcmnkiojgfpbkfbgj"
const otherExtension = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
const production = { NODE_ENV: "production", APP_ORIGIN: app }

describe("API origin allowlist", () => {
  it("accepts the app origin and rejects every other origin by default", () => {
    expect(isAllowedOrigin(app, production)).toBe(true)
    expect(isAllowedOrigin("https://attacker.test", production)).toBe(false)
    expect(isAllowedOrigin(extension, production)).toBe(false)
    expect(isAllowedOrigin(null, production)).toBe(false)
    expect(isAllowedOrigin("null", production)).toBe(false)
  })

  it("accepts only the extension origins listed in EXTENSION_ORIGINS", () => {
    const settings = {
      ...production,
      EXTENSION_ORIGINS: ` ${extension} , chrome-extension://not-an-id`,
    }
    expect(isAllowedOrigin(extension, settings)).toBe(true)
    expect(isAllowedOrigin(app, settings)).toBe(true)
    expect(isAllowedOrigin(otherExtension, settings)).toBe(false)
    expect(isAllowedOrigin("chrome-extension://not-an-id", settings)).toBe(
      false
    )
    expect(isAllowedOrigin(`${extension}/`, settings)).toBe(false)
    expect(isAllowedOrigin("https://attacker.test", settings)).toBe(false)
  })

  it("ignores malformed extension entries instead of widening access", () => {
    expect(
      extensionOrigins(
        [
          extension,
          "*",
          "chrome-extension://*",
          `${extension}/`,
          "chrome-extension://IBFOCPOGCDOOLFMHCMNKIOJGFPBKFBGJ",
          "moz-extension://ibfocpogcdoolfmhcmnkiojgfpbkfbgj",
          "https://app.example.test",
          "",
        ].join(",")
      )
    ).toEqual([extension])
    expect(extensionOrigins(undefined)).toEqual([])
  })

  it("keeps failing closed when the app origin is missing or invalid", () => {
    const settings = { EXTENSION_ORIGINS: extension }
    expect(
      isAllowedOrigin(extension, { ...settings, NODE_ENV: "production" })
    ).toBe(false)
    expect(
      isAllowedOrigin(extension, {
        ...settings,
        NODE_ENV: "production",
        APP_ORIGIN: "http://app.example.test",
      })
    ).toBe(false)
    expect(
      isAllowedOrigin(extension, { ...settings, APP_ORIGIN: `${app}/` })
    ).toBe(false)
    // Development without APP_ORIGIN accepts any origin, as before.
    expect(
      isAllowedOrigin("http://localhost:3000", { NODE_ENV: "development" })
    ).toBe(true)
  })
})
