"use client"

import { useCallback, useState } from "react"
import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  PASSPHRASE_SEPARATORS,
  PASSPHRASE_WORD_COUNT_MAX,
  PASSPHRASE_WORD_COUNT_MIN,
  PASSWORD_LENGTH_MIN,
  generatePassphrase,
  generatePassword,
  loadPassphraseWords,
  type PassphraseOptions,
  type PassphraseSeparator,
  type PasswordOptions,
} from "@/lib/password-generator"
import { cn } from "@/lib/utils"

const PASSWORD_LENGTH_SLIDER_MAX = 64

const OPTION_LABELS: Array<{
  key: keyof Pick<
    PasswordOptions,
    "lowercase" | "uppercase" | "digits" | "symbols"
  >
  label: string
}> = [
  { key: "lowercase", label: "Lowercase" },
  { key: "uppercase", label: "Uppercase" },
  { key: "digits", label: "Numbers" },
  { key: "symbols", label: "Symbols" },
]

const PASSPHRASE_TOGGLES: Array<{
  key: keyof Pick<PassphraseOptions, "capitalize" | "includeNumber">
  label: string
}> = [
  { key: "capitalize", label: "Capitalize words" },
  { key: "includeNumber", label: "Include a number" },
]

export type GeneratedKind = "password" | "passphrase"

export interface PasswordGeneratorPanelProps {
  renderActions?(password: string, kind: GeneratedKind): React.ReactNode
  className?: string
}

interface GeneratedPreview {
  password: string
  error: string | null
}

function previewFrom(generate: () => string): GeneratedPreview {
  try {
    return { password: generate(), error: null }
  } catch (caught) {
    return {
      password: "",
      error: caught instanceof Error ? caught.message : "Generation failed.",
    }
  }
}

function passwordPreview(options: PasswordOptions): GeneratedPreview {
  return previewFrom(() => generatePassword(options))
}

function passphrasePreview(
  options: PassphraseOptions,
  words: readonly string[] | null
): GeneratedPreview {
  if (!words) return { password: "", error: null }
  return previewFrom(() => generatePassphrase(options, words))
}

const WORD_LIST_ERROR =
  "Passphrase words could not be loaded. Check your connection and try again."

export function PasswordGeneratorPanel({
  renderActions,
  className,
}: PasswordGeneratorPanelProps) {
  const [kind, setKind] = useState<GeneratedKind>("password")
  const [options, setOptions] = useState<PasswordOptions>(
    DEFAULT_PASSWORD_OPTIONS
  )
  const [passphraseOptions, setPassphraseOptions] = useState<PassphraseOptions>(
    DEFAULT_PASSPHRASE_OPTIONS
  )
  const [words, setWords] = useState<readonly string[] | null>(null)
  const [wordsFailed, setWordsFailed] = useState(false)
  const [preview, setPreview] = useState<GeneratedPreview>(() =>
    passwordPreview(DEFAULT_PASSWORD_OPTIONS)
  )
  const [passphrase, setPassphrase] = useState<GeneratedPreview>({
    password: "",
    error: null,
  })

  // Loads the word list the first time passphrases are chosen. The options
  // stay disabled until it arrives, so `forOptions` is still current then.
  const loadWords = useCallback((forOptions: PassphraseOptions) => {
    setWordsFailed(false)
    loadPassphraseWords().then(
      (list) => {
        setWords(list)
        setPassphrase(passphrasePreview(forOptions, list))
      },
      () => setWordsFailed(true)
    )
  }, [])

  const chooseKind = useCallback(
    (next: GeneratedKind) => {
      setKind(next)
      if (next === "passphrase" && !words) loadWords(passphraseOptions)
    },
    [loadWords, passphraseOptions, words]
  )

  const regenerate = useCallback(() => {
    if (kind === "password") {
      setPreview(passwordPreview(options))
    } else {
      setPassphrase(passphrasePreview(passphraseOptions, words))
    }
  }, [kind, options, passphraseOptions, words])

  const updateOption = useCallback(
    <Key extends keyof PasswordOptions>(
      key: Key,
      value: PasswordOptions[Key]
    ) => {
      const next = { ...options, [key]: value }
      setOptions(next)
      setPreview(passwordPreview(next))
    },
    [options]
  )

  const updatePassphraseOption = useCallback(
    <Key extends keyof PassphraseOptions>(
      key: Key,
      value: PassphraseOptions[Key]
    ) => {
      const next = { ...passphraseOptions, [key]: value }
      setPassphraseOptions(next)
      setPassphrase(passphrasePreview(next, words))
    },
    [passphraseOptions, words]
  )

  const current = kind === "password" ? preview : passphrase
  const error =
    current.error ??
    (kind === "passphrase" && wordsFailed ? WORD_LIST_ERROR : null)
  const noun = kind === "password" ? "password" : "passphrase"

  return (
    <div className={cn("space-y-4", className)}>
      <div
        role="radiogroup"
        aria-label="Generate"
        className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
      >
        {(["password", "passphrase"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            className={cn(
              "h-8 rounded-md text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              kind === option &&
                "bg-background text-foreground shadow-sm ring-1 ring-border"
            )}
            onClick={() => chooseKind(option)}
          >
            {option === "password" ? "Password" : "Passphrase"}
          </button>
        ))}
      </div>

      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="flex items-start gap-2">
          <output
            htmlFor={
              kind === "password" ? "password-length" : "passphrase-words"
            }
            className="min-h-10 flex-1 rounded-md bg-background px-3 py-2 font-mono text-sm break-all ring-1 ring-border"
            aria-label={`Generated ${noun} preview`}
            aria-live="polite"
          >
            {current.password || "—"}
          </output>
          <Button
            className="size-10 shrink-0"
            type="button"
            size="icon"
            variant="outline"
            onClick={
              kind === "passphrase" && wordsFailed
                ? () => loadWords(passphraseOptions)
                : regenerate
            }
            disabled={kind === "passphrase" && !words && !wordsFailed}
            aria-label={`Regenerate ${noun}`}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {kind === "password" ? (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="password-length">Length</Label>
              <span className="rounded bg-muted px-2 py-1 font-mono text-xs ring-1 ring-border">
                {options.length}
              </span>
            </div>
            <input
              id="password-length"
              className="w-full accent-foreground"
              type="range"
              min={PASSWORD_LENGTH_MIN}
              max={PASSWORD_LENGTH_SLIDER_MAX}
              step={1}
              value={options.length}
              onChange={(event) =>
                updateOption("length", Number(event.target.value))
              }
            />
            <div className="flex justify-between text-[0.6875rem] text-muted-foreground">
              <span>{PASSWORD_LENGTH_MIN}</span>
              <span>{PASSWORD_LENGTH_SLIDER_MAX}</span>
            </div>
          </div>

          <fieldset className="grid grid-cols-2 gap-3">
            <legend className="sr-only">Character types</legend>
            {OPTION_LABELS.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={`password-option-${key}`}
                  checked={options[key]}
                  onCheckedChange={(checked) =>
                    updateOption(key, checked === true)
                  }
                />
                <Label htmlFor={`password-option-${key}`}>{label}</Label>
              </div>
            ))}
          </fieldset>
        </>
      ) : (
        <>
          <fieldset className="space-y-4" disabled={!words}>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="passphrase-words">Words</Label>
                <span className="rounded bg-muted px-2 py-1 font-mono text-xs ring-1 ring-border">
                  {passphraseOptions.wordCount}
                </span>
              </div>
              <input
                id="passphrase-words"
                className="w-full accent-foreground"
                type="range"
                min={PASSPHRASE_WORD_COUNT_MIN}
                max={PASSPHRASE_WORD_COUNT_MAX}
                step={1}
                value={passphraseOptions.wordCount}
                onChange={(event) =>
                  updatePassphraseOption(
                    "wordCount",
                    Number(event.target.value)
                  )
                }
              />
              <div className="flex justify-between text-[0.6875rem] text-muted-foreground">
                <span>{PASSPHRASE_WORD_COUNT_MIN}</span>
                <span>{PASSPHRASE_WORD_COUNT_MAX}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="passphrase-separator">Separator</Label>
              <select
                id="passphrase-separator"
                className="h-10 w-full rounded-md border border-input bg-input/20 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                value={passphraseOptions.separator}
                onChange={(event) =>
                  updatePassphraseOption(
                    "separator",
                    event.target.value as PassphraseSeparator
                  )
                }
              >
                {PASSPHRASE_SEPARATORS.map(({ value, label }) => (
                  <option key={label} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="sr-only">Passphrase options</legend>
              {PASSPHRASE_TOGGLES.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={`passphrase-option-${key}`}
                    disabled={!words}
                    checked={passphraseOptions[key]}
                    onCheckedChange={(checked) =>
                      updatePassphraseOption(key, checked === true)
                    }
                  />
                  <Label htmlFor={`passphrase-option-${key}`}>{label}</Label>
                </div>
              ))}
            </fieldset>
          </fieldset>
        </>
      )}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {renderActions ? renderActions(current.password, kind) : null}
    </div>
  )
}
