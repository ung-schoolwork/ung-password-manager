import { describe, expect, it } from "bun:test"

import {
  credentialsForSite,
  fillProblem,
  hostMatchesSite,
  savedSiteHost,
  tabSiteHost,
} from "../../../lib/vault/site-match"

describe("savedSiteHost", () => {
  it("reads a host from free text with or without a scheme, path or www", () => {
    for (const text of [
      "example.com",
      "Example.COM",
      "  example.com  ",
      "www.example.com",
      "https://example.com",
      "http://www.example.com/login?next=/home",
      "example.com/login",
      "example.com:8443",
      "example.com.",
    ])
      expect(savedSiteHost(text)).toBe("example.com")
    expect(savedSiteHost("accounts.example.com")).toBe("accounts.example.com")
    expect(savedSiteHost("127.0.0.1:3100")).toBe("127.0.0.1")
  })

  it("returns null for text that is not a web address", () => {
    for (const text of [
      "",
      "   ",
      "My bank app",
      "ftp://example.com",
      "android://com.example.app",
      "mailto:someone@example.com",
      "someone@example.com",
      "javascript:alert(1)",
      "https://",
    ])
      expect(savedSiteHost(text)).toBeNull()
  })
})

describe("tabSiteHost", () => {
  it("reads the host of http and https pages only", () => {
    expect(tabSiteHost("https://www.example.com/login")).toBe("example.com")
    expect(tabSiteHost("http://accounts.example.com:8080/")).toBe(
      "accounts.example.com"
    )
    for (const url of [
      "chrome://settings",
      "chrome-extension://ibfocpogcdoolfmhcmnkiojgfpbkfbgj/popup.html",
      "file:///home/user/page.html",
      "about:blank",
      "not a url",
      "",
      null,
      undefined,
    ])
      expect(tabSiteHost(url)).toBeNull()
  })
})

describe("hostMatchesSite", () => {
  it("matches the saved host and its subdomains", () => {
    expect(hostMatchesSite("example.com", "example.com")).toBe(true)
    expect(hostMatchesSite("accounts.example.com", "example.com")).toBe(true)
    expect(hostMatchesSite("a.b.example.com", "example.com")).toBe(true)
    expect(hostMatchesSite("login.example.co.uk", "example.co.uk")).toBe(true)
  })

  it("does not match a parent domain, a sibling, or an unrelated suffix", () => {
    expect(hostMatchesSite("example.com", "accounts.example.com")).toBe(false)
    expect(hostMatchesSite("mail.example.com", "accounts.example.com")).toBe(
      false
    )
    expect(hostMatchesSite("evil-example.com", "example.com")).toBe(false)
    expect(hostMatchesSite("example.com.evil.test", "example.com")).toBe(false)
    expect(hostMatchesSite("notexample.com", "example.com")).toBe(false)
  })

  it("never lets a bare top-level domain, single label, or IP address cover other hosts", () => {
    expect(hostMatchesSite("example.com", "com")).toBe(false)
    expect(hostMatchesSite("app.localhost", "localhost")).toBe(false)
    expect(hostMatchesSite("localhost", "localhost")).toBe(true)
    expect(hostMatchesSite("1.127.0.0.1", "127.0.0.1")).toBe(false)
    expect(hostMatchesSite("127.0.0.1", "127.0.0.1")).toBe(true)
  })
})

describe("credentialsForSite", () => {
  const saved = [
    { id: "root", siteOrApp: "example.com" },
    { id: "www", siteOrApp: "https://www.example.com/login" },
    { id: "accounts", siteOrApp: "accounts.example.com" },
    { id: "mail", siteOrApp: "mail.example.com" },
    { id: "lookalike", siteOrApp: "evil-example.com" },
    { id: "tld", siteOrApp: "com" },
    { id: "app", siteOrApp: "Example desktop app" },
  ]
  const ids = (url: string | null) =>
    credentialsForSite(saved, url).map(({ id }) => id)

  it("lists the credentials saved for the tab's site, in order", () => {
    expect(ids("https://accounts.example.com/sign-in")).toEqual([
      "root",
      "www",
      "accounts",
    ])
    expect(ids("https://www.example.com/")).toEqual(["root", "www"])
    expect(ids("https://evil-example.com/")).toEqual(["lookalike"])
  })

  it("finds nothing for pages that are not websites", () => {
    expect(ids("chrome://newtab")).toEqual([])
    expect(ids("file:///tmp/example.com.html")).toEqual([])
    expect(ids(null)).toEqual([])
  })
})

describe("fillProblem", () => {
  it("allows filling on HTTPS pages of the login's site and its subdomains", () => {
    expect(fillProblem("https://example.com/login", "example.com")).toBeNull()
    expect(
      fillProblem("https://accounts.example.com/", "https://www.example.com")
    ).toBeNull()
  })

  it("allows plain http only on this computer", () => {
    expect(fillProblem("http://localhost:3000/login", "localhost")).toBeNull()
    expect(fillProblem("http://127.0.0.1:3100/", "127.0.0.1:3100")).toBeNull()
    expect(fillProblem("http://[::1]:8080/", "http://[::1]")).toBeNull()
    expect(fillProblem("http://example.com/login", "example.com")).toBe(
      "insecure"
    )
    expect(fillProblem("http://app.localhost/", "app.localhost")).toBe(
      "insecure"
    )
  })

  it("refuses pages on another site", () => {
    expect(fillProblem("https://example.com/", "accounts.example.com")).toBe(
      "different-site"
    )
    expect(fillProblem("https://evil-example.com/", "example.com")).toBe(
      "different-site"
    )
    expect(fillProblem("https://example.org/", "example.com")).toBe(
      "different-site"
    )
  })

  it("refuses pages that are not websites and logins without a website", () => {
    for (const url of [
      "chrome://settings",
      "file:///tmp/login.html",
      "about:blank",
      "javascript:alert(1)",
      "https://user@example.com/",
      "",
      null,
      undefined,
    ])
      expect(fillProblem(url, "example.com")).toBe("not-a-website")
    expect(fillProblem("https://example.com/", "My bank app")).toBe(
      "no-website"
    )
  })
})
