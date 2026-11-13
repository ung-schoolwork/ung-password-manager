"use client"

import { useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, Upload, XCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ImportParseResult } from "@/lib/vault/csv-import"
import {
  IMPORT_FILE_ACCEPT,
  ImportFileError,
  readImportFile,
} from "@/lib/vault/import-file"
import {
  buildImportReport,
  SAVE_FAILED_REASON,
  type ImportReport,
  type ImportSaveResult,
} from "@/lib/vault/import-report"
import type { CredentialDraft } from "@/lib/vault/types"

type ImportStep = "select" | "reading" | "preview" | "importing" | "result"

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

export function ImportCredentialsDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  /** Saves the ready rows and reports each one's result, in the same order. */
  onImport(credentials: CredentialDraft[]): Promise<ImportSaveResult[]>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<ImportStep>("select")
  const [fileName, setFileName] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<ImportParseResult | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [dragging, setDragging] = useState(false)
  // Bumped every time the dialog resets (including on close). An in-flight
  // read or import captures the current value and checks it again once it
  // resolves, so a close-while-busy can't resurrect stale UI state after the
  // dialog has already been reset.
  const generationRef = useRef(0)

  function reset() {
    generationRef.current += 1
    setStep("select")
    setFileName(null)
    setParseResult(null)
    setFileError(null)
    setReport(null)
    setDragging(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  async function readFile(file: File) {
    const generation = generationRef.current
    setFileError(null)
    setStep("reading")

    try {
      const result = await readImportFile(file)
      if (generationRef.current !== generation) return
      setFileName(file.name)
      setParseResult(result)
      setStep("preview")
    } catch (error) {
      if (generationRef.current !== generation) return
      setFileError(
        error instanceof ImportFileError
          ? error.message
          : "We couldn't read that file. Try exporting it again."
      )
      setStep("select")
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) void readFile(file)
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void readFile(file)
  }

  async function handleConfirmImport() {
    if (!parseResult) return

    const credentials = parseResult.rows.flatMap((row) =>
      row.status === "ok" ? [row.data] : []
    )

    const generation = generationRef.current
    setStep("importing")

    let results: ImportSaveResult[]
    try {
      results = await onImport(credentials)
    } catch {
      results = credentials.map(() => ({
        ok: false,
        reason: SAVE_FAILED_REASON,
      }))
    }

    // The dialog was closed (and reset) while this import was running. Let
    // it keep running to completion in the background, but don't show its
    // result in what is now a fresh dialog.
    if (generationRef.current !== generation) return

    setReport(buildImportReport(parseResult, results))
    setStep("result")
  }

  const readyRows = parseResult?.rows.filter((row) => row.status === "ok") ?? []
  const problemRows =
    parseResult?.rows.filter((row) => row.status === "issue") ?? []

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {(step === "select" || step === "reading") && (
          <>
            <DialogHeader>
              <DialogTitle>Import credentials</DialogTitle>
              <DialogDescription>
                Choose a CSV or Excel (.xlsx) file with your login credentials.
                The first row should contain column names such as{" "}
                <span className="font-mono text-xs">
                  account, website, username, password
                </span>
                .
              </DialogDescription>
            </DialogHeader>

            <div
              role="button"
              tabIndex={0}
              aria-disabled={step === "reading"}
              className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center ${
                dragging ? "border-primary bg-primary/5" : "bg-muted/20"
              }`}
              onClick={() => {
                if (step === "select") fileInputRef.current?.click()
              }}
              onKeyDown={(event) => {
                if (
                  step === "select" &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <Upload
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm font-medium">
                {step === "reading"
                  ? "Reading your file…"
                  : "Click to choose a CSV or Excel file"}
              </p>
              <p className="text-xs text-muted-foreground">
                or drag and drop it here
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={IMPORT_FILE_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              onChange={handleFileSelected}
            />

            {fileError ? (
              <p className="text-sm text-destructive" role="alert">
                {fileError}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "preview" && parseResult && (
          <>
            <DialogHeader>
              <DialogTitle>Review before importing</DialogTitle>
              <DialogDescription>
                {readyRows.length} of {parseResult.rows.length} rows are ready
                to import.
                {problemRows.length > 0
                  ? ` ${problemRows.length} need attention and will be skipped.`
                  : ""}
              </DialogDescription>
            </DialogHeader>

            {fileName ? (
              <p className="truncate text-xs text-muted-foreground">
                {fileName}
              </p>
            ) : null}

            <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
              {readyRows.length > 0 ? (
                <section aria-label="Ready to import">
                  <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Ready to import
                  </h3>
                  <ul className="space-y-1.5">
                    {readyRows.map((row) =>
                      row.status === "ok" ? (
                        <li
                          key={row.line}
                          className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm"
                        >
                          <CheckCircle2
                            className="mt-0.5 size-4 shrink-0 text-emerald-600"
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {row.data.accountName}{" "}
                              <span className="font-normal text-muted-foreground">
                                · {row.data.siteOrApp}
                              </span>
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              Row {row.line} · {row.data.username}
                            </p>
                          </div>
                        </li>
                      ) : null
                    )}
                  </ul>
                </section>
              ) : null}

              {problemRows.length > 0 ? (
                <section aria-label="Rows with problems">
                  <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Rows with problems
                  </h3>
                  <ul className="space-y-1.5">
                    {problemRows.map((row) =>
                      row.status === "issue" ? (
                        <li
                          key={row.line}
                          className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm"
                        >
                          <AlertTriangle
                            className="mt-0.5 size-4 shrink-0 text-amber-600"
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <p className="font-medium">Row {row.line}</p>
                            <p className="text-xs text-muted-foreground">
                              {row.reason}
                            </p>
                          </div>
                        </li>
                      ) : null
                    )}
                  </ul>
                </section>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>
                Choose a different file
              </Button>
              <Button
                type="button"
                onClick={handleConfirmImport}
                disabled={readyRows.length === 0}
              >
                Import {plural(readyRows.length, "credential", "credentials")}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "importing" && (
          <>
            <DialogHeader>
              <DialogTitle>Importing…</DialogTitle>
              <DialogDescription>
                Encrypting and saving your credentials. This only takes a
                moment.
              </DialogDescription>
            </DialogHeader>
          </>
        )}

        {step === "result" && report && (
          <>
            <DialogHeader>
              <DialogTitle>Import complete</DialogTitle>
              <DialogDescription>
                {plural(report.importedCount, "credential", "credentials")}{" "}
                added to your vault.
                {report.failedCount > 0
                  ? ` ${plural(report.failedCount, "row", "rows")} not imported.`
                  : ""}
              </DialogDescription>
            </DialogHeader>

            <ul
              aria-label="Import results"
              className="max-h-80 space-y-1.5 overflow-y-auto pr-1"
            >
              {report.rows.map((row) => (
                <li
                  key={row.line}
                  className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm"
                >
                  {row.status === "imported" ? (
                    <>
                      <CheckCircle2
                        className="mt-0.5 size-4 shrink-0 text-emerald-600"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {row.accountName}{" "}
                          <span className="font-normal text-muted-foreground">
                            · {row.siteOrApp}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Row {row.line} · Imported
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <XCircle
                        className="mt-0.5 size-4 shrink-0 text-destructive"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="font-medium">
                          Row {row.line} · Not imported
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.reason}
                        </p>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>

            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
