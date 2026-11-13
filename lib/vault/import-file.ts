import {
  parseCredentialRecords,
  parseCsvRecords,
  type ImportParseResult,
} from "@/lib/vault/csv-import"
import { readXlsxFirstSheet, XlsxReadError } from "@/lib/vault/xlsx-reader"

/** Largest file the import dialog reads. */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024
/** Most data rows (not counting the header row) read from one file. */
export const MAX_IMPORT_ROWS = 5000

export const IMPORT_FILE_ACCEPT = [
  ".csv",
  "text/csv",
  ".xlsx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",")

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ImportFileError"
  }
}

type ImportFileKind = "csv" | "xlsx"

function detectKind(file: Pick<File, "name" | "type">): ImportFileKind | null {
  const name = file.name.toLowerCase()
  if (
    name.endsWith(".xlsx") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "xlsx"
  }
  if (
    name.endsWith(".csv") ||
    file.type === "text/csv" ||
    // Windows often labels .csv files with the legacy Excel type.
    (file.type === "application/vnd.ms-excel" && !name.endsWith(".xls"))
  ) {
    return "csv"
  }
  return null
}

/**
 * Reads a chosen .csv or .xlsx file in memory and validates its rows.
 * The file never leaves the browser.
 */
export async function readImportFile(
  file: Pick<File, "name" | "type" | "size" | "text" | "arrayBuffer">
): Promise<ImportParseResult> {
  const kind = detectKind(file)
  if (!kind) {
    throw new ImportFileError(
      "Choose a .csv or .xlsx file. If your spreadsheet is in another format, save it as one of those and try again."
    )
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new ImportFileError(
      "That file is larger than 5 MB. Split it into smaller files and try again."
    )
  }

  const tooManyRows = new ImportFileError(
    "That file has more than 5,000 rows. Split it into smaller files and try again."
  )

  let records
  try {
    records =
      kind === "xlsx"
        ? await readXlsxFirstSheet(await file.arrayBuffer(), {
            maxRecords: MAX_IMPORT_ROWS + 1,
          })
        : parseCsvRecords(await file.text())
  } catch (error) {
    if (error instanceof XlsxReadError) {
      throw error.code === "too-many-rows"
        ? tooManyRows
        : new ImportFileError(error.message)
    }
    throw new ImportFileError(
      "We couldn't read that file. Try exporting it again."
    )
  }

  if (records.length > MAX_IMPORT_ROWS + 1) throw tooManyRows

  const result = parseCredentialRecords(records)
  if (result.rows.length === 0) {
    throw new ImportFileError("That file doesn't have any rows to import.")
  }
  return result
}
