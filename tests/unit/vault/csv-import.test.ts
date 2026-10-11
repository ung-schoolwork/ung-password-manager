import { describe, expect, it } from "bun:test"

import { parseCredentialsCsv } from "@/lib/vault/csv-import"

describe("parseCredentialsCsv", () => {
  it("reads browser-style exports and keeps passwords exactly as written", () => {
    const result = parseCredentialsCsv(
      'name,url,username,password,note\r\nPortal, portal.example.edu ,student," Demo, pass ",Shared desk\r\n'
    )

    expect(result.okCount).toBe(1)
    expect(result.rows[0]).toEqual({
      line: 2,
      status: "ok",
      data: {
        accountName: "Portal",
        siteOrApp: "portal.example.edu",
        username: "student",
        password: " Demo, pass ",
        notes: "Shared desk",
      },
    })
  })

  it("keeps quoted line breaks inside one row and reports the row's first line", () => {
    const result = parseCredentialsCsv(
      'account,website,username,password,notes\nBank,bank.example,me,Demo!1,"line one\nline two"\nMail,,me,Demo!2,\n'
    )

    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({
      line: 2,
      status: "ok",
      data: { notes: "line one\nline two" },
    })
    expect(result.rows[1]).toMatchObject({
      line: 4,
      status: "issue",
      reason: "Missing website or app.",
    })
  })

  it("flags every row when a required column is absent", () => {
    const result = parseCredentialsCsv(
      "url,username,password\na.example,me,Demo!1\n"
    )

    expect(result.okCount).toBe(0)
    expect(result.rows[0]).toMatchObject({
      status: "issue",
      reason: "The file has no account label column.",
    })
  })

  it("treats a whitespace-only password as missing and ignores blank lines", () => {
    const result = parseCredentialsCsv(
      "account,website,username,password\n\nA,a.example,me,   \n\n"
    )

    expect(result.rows).toEqual([
      expect.objectContaining({ line: 3, reason: "Missing password." }),
    ])
  })
})
