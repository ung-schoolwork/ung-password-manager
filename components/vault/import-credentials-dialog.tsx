"use client"

import { useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  parseCredentialsCsv,
  type ImportParseResult,
} from "@/lib/vault/csv-import"
import type { CredentialDraft } from "@/lib/vault/types"

export type ImportOutcome = {
  succeeded: number
  failed: number
}

type ImportStep = "select" | "preview" | "importing" | "result"

export function ImportCredentialsDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  onImport(credentials: CredentialDraft[]): Promise<ImportOutcome>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<ImportStep>("select")
  const [parseResult, setParseResult] = useState<ImportParseResult | null>(
    null
  )
  const [fileError, setFileError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)

  function reset() {
    setStep("select")
    setParseResult(null)
    setFileError(null)
    setOutcome(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  async function handleFileSelected(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0]
    if (!file) return

    const isCsv =
      file.name.toLowerCase().endsWith(".csv") ||
      file.type === "text/csv" ||
      file.type === "application/vnd.ms-excel"

    if (!isCsv) {
      setFileError(
        "That file doesn't look like a CSV. Export your spreadsheet as .csv and try again."
      )
      return
    }

    setFileError(null)

    try {
      const text = await file.text()
      const result = parseCredentialsCsv(text)

      if (result.rows.length === 0) {
        setFileError("That file doesn't have any rows to import.")
        return
      }

      setParseResult(result)
      setStep("preview")
    } catch {
      setFileError("We couldn't read that file. Try exporting it again.")
    }
  }

  async function handleConfirmImport() {
    if (!parseResult) return

    const credentials = parseResult.rows
      .filter((row) => row.status === "ok")
      .map((row) => (row as { data: CredentialDraft }).data)

    setStep("importing")

    try {
      const result = await onImport(credentials)
      setOutcome(result)
    } catch {
      setOutcome({ succeeded: 0, failed: credentials.length })
    } finally {
      setStep("result")
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {step === "select" && (
          <>
            <DialogHeader>
              <DialogTitle>Import credentials</DialogTitle>
              <DialogDescription>
                Choose a CSV file with your login credentials. The first row
                should contain column names such as{" "}
                <span className="font-mono text-xs">
                  account, website, username, password
                </span>
                .
              </DialogDescription>
            </DialogHeader>

            <div
              className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 p-8 text-center"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm font-medium">Click to choose a CSV file</p>
              <p className="text-xs text-muted-foreground">
                or drag and drop it here
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
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
                {parseResult.okCount} of {parseResult.rows.length} rows are
                ready to import.
                {parseResult.issueCount > 0
                  ? ` ${parseResult.issueCount} need attention and will be skipped.`
                  : ""}
              </DialogDescription>
            </DialogHeader>

            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {parseResult.rows.map((row) => (
                <li
                  key={row.line}
                  className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm"
                >
                  {row.status === "ok" ? (
                    <>
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
                          {row.data.username}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </li>
              ))}
            </ul>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>
                Choose a different file
              </Button>
              <Button
                type="button"
                onClick={handleConfirmImport}
                disabled={parseResult.okCount === 0}
              >
                Import {parseResult.okCount}{" "}
                {parseResult.okCount === 1 ? "credential" : "credentials"}
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

        {step === "result" && parseResult && outcome && (
          <>
            <DialogHeader>
              <DialogTitle>Import complete</DialogTitle>
              <DialogDescription>
                {outcome.succeeded}{" "}
                {outcome.succeeded === 1 ? "credential" : "credentials"}{" "}
                added to your vault.
                {outcome.failed > 0
                  ? ` ${outcome.failed} could not be saved.`
                  : ""}
                {parseResult.issueCount > 0
                  ? ` ${parseResult.issueCount} row(s) need attention.`
                  : ""}
              </DialogDescription>
            </DialogHeader>

            {parseResult.issueCount > 0 ? (
              <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {parseResult.rows
                  .filter((row) => row.status === "issue")
                  .map((row) => (
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
                  ))}
              </ul>
            ) : null}

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
