import type { CredentialDraft } from "@/lib/vault/types"

export type ImportRowResult =
  | { line: number; status: "ok"; data: CredentialDraft }
  | { line: number; status: "issue"; reason: string; raw: string[] }

export type ImportParseResult = {
  rows: ImportRowResult[]
  okCount: number
  issueCount: number
}

// Column names we recognize, in order of preference. The first match
// in a row's header becomes that field. Case-insensitive, trimmed.
const HEADER_ALIASES: Record<
  "accountName" | "siteOrApp" | "username" | "password" | "notes",
  string[]
> = {
  accountName: ["account", "accountname", "account label", "label", "name"],
  siteOrApp: ["site", "website", "siteorapp", "website or app", "url", "app"],
  username: ["username", "user", "login", "email"],
  password: ["password", "pass", "pwd"],
  notes: ["notes", "note", "comment", "comments"],
}

const REQUIRED_FIELDS = [
  "accountName",
  "siteOrApp",
  "username",
  "password",
] as const

/**
 * Parses one line of CSV text into fields, honoring double-quoted
 * values that may contain commas or escaped quotes ("").
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ",") {
      fields.push(current)
      current = ""
    } else {
      current += char
    }
  }

  fields.push(current)
  return fields.map((field) => field.trim())
}

function splitIntoLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0)
}

function buildHeaderMap(
  headerRow: string[]
): Partial<Record<keyof typeof HEADER_ALIASES, number>> {
  const map: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {}

  headerRow.forEach((rawHeader, index) => {
    const normalized = rawHeader.trim().toLowerCase()
    for (const field of Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]) {
      if (map[field] !== undefined) continue
      if (HEADER_ALIASES[field].includes(normalized)) {
        map[field] = index
      }
    }
  })

  return map
}

/**
 * Parses CSV file text into recognized credential rows plus rows
 * that need attention (missing required fields, unreadable row, etc).
 */
export function parseCredentialsCsv(text: string): ImportParseResult {
  const lines = splitIntoLines(text)

  if (lines.length === 0) {
    return { rows: [], okCount: 0, issueCount: 0 }
  }

  const headerRow = parseCsvLine(lines[0])
  const headerMap = buildHeaderMap(headerRow)

  const missingRequired = REQUIRED_FIELDS.filter(
    (field) => headerMap[field] === undefined
  )

  const rows: ImportRowResult[] = []

  if (missingRequired.length > 0) {
    // Header itself is unusable — every data row needs attention.
    for (let i = 1; i < lines.length; i++) {
      rows.push({
        line: i + 1,
        status: "issue",
        reason: `Missing required column(s): ${missingRequired.join(", ")}`,
        raw: parseCsvLine(lines[i]),
      })
    }
    return { rows, okCount: 0, issueCount: rows.length }
  }

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i])
    const lineNumber = i + 1

    const get = (field: keyof typeof HEADER_ALIASES): string => {
      const index = headerMap[field]
      if (index === undefined || index >= fields.length) return ""
      return fields[index] ?? ""
    }

    const accountName = get("accountName")
    const siteOrApp = get("siteOrApp")
    const username = get("username")
    const password = get("password")
    const notes = get("notes")

    const missingFields = REQUIRED_FIELDS.filter((field) => get(field) === "")

    if (missingFields.length > 0) {
      rows.push({
        line: lineNumber,
        status: "issue",
        reason: `Missing ${missingFields.join(", ")}`,
        raw: fields,
      })
      continue
    }

    rows.push({
      line: lineNumber,
      status: "ok",
      data: {
        accountName,
        siteOrApp,
        username,
        password,
        notes: notes || undefined,
      },
    })
  }

  const okCount = rows.filter((row) => row.status === "ok").length

  return {
    rows,
    okCount,
    issueCount: rows.length - okCount,
  }
}