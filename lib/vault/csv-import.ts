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

const FIELD_LABELS: Record<keyof typeof HEADER_ALIASES, string> = {
  accountName: "account label",
  siteOrApp: "website or app",
  username: "username",
  password: "password",
  notes: "notes",
}

type CsvRecord = { line: number; fields: string[] }

/**
 * Splits CSV text into records, honoring double-quoted values that may
 * contain commas, line breaks, or escaped quotes (""). Fields are not
 * trimmed so passwords keep their exact characters.
 */
function parseCsvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = []
  let fields: string[] = []
  let current = ""
  let inQuotes = false
  let line = 1
  let recordLine = 1

  const endRecord = () => {
    fields.push(current)
    if (fields.some((field) => field.trim().length > 0)) {
      records.push({ line: recordLine, fields })
    }
    fields = []
    current = ""
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const isLineBreak = char === "\n" || char === "\r"
    if (isLineBreak) {
      if (char === "\r" && text[i + 1] === "\n") i++
      line++
    }

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += isLineBreak ? "\n" : char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ",") {
      fields.push(current)
      current = ""
    } else if (isLineBreak) {
      endRecord()
      recordLine = line
    } else {
      current += char
    }
  }

  if (current.length > 0 || fields.length > 0) endRecord()
  return records
}

function buildHeaderMap(
  headerRow: string[]
): Partial<Record<keyof typeof HEADER_ALIASES, number>> {
  const map: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {}

  headerRow.forEach((rawHeader, index) => {
    const normalized = rawHeader.trim().toLowerCase()
    for (const field of Object.keys(
      HEADER_ALIASES
    ) as (keyof typeof HEADER_ALIASES)[]) {
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
  const [header, ...records] = parseCsvRecords(text)

  if (!header) {
    return { rows: [], okCount: 0, issueCount: 0 }
  }

  const headerMap = buildHeaderMap(header.fields)

  const missingRequired = REQUIRED_FIELDS.filter(
    (field) => headerMap[field] === undefined
  )

  const rows: ImportRowResult[] = []

  if (missingRequired.length > 0) {
    // Header itself is unusable — every data row needs attention.
    const labels = missingRequired.map((field) => FIELD_LABELS[field])
    for (const record of records) {
      rows.push({
        line: record.line,
        status: "issue",
        reason: `The file has no ${labels.join(", ")} column.`,
        raw: record.fields,
      })
    }
    return { rows, okCount: 0, issueCount: rows.length }
  }

  for (const { line: lineNumber, fields } of records) {
    // Passwords are kept exactly as written; other fields are trimmed.
    const get = (field: keyof typeof HEADER_ALIASES): string => {
      const index = headerMap[field]
      if (index === undefined || index >= fields.length) return ""
      const value = fields[index] ?? ""
      return field === "password" ? value : value.trim()
    }

    const accountName = get("accountName")
    const siteOrApp = get("siteOrApp")
    const username = get("username")
    const password = get("password")
    const notes = get("notes")

    const missingFields = REQUIRED_FIELDS.filter(
      (field) => get(field).trim() === ""
    )

    if (missingFields.length > 0) {
      rows.push({
        line: lineNumber,
        status: "issue",
        reason: `Missing ${missingFields.map((field) => FIELD_LABELS[field]).join(", ")}.`,
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
