export const PASSWORD_LENGTH_MIN = 12
export const PASSWORD_LENGTH_MAX = 128

export const PASSWORD_CHARACTER_SETS = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?",
} as const

export interface PasswordOptions {
  length: number
  lowercase: boolean
  uppercase: boolean
  digits: boolean
  symbols: boolean
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
}

export type RandomIndex = (upperExclusive: number) => number

function secureRandomIndex(upperExclusive: number): number {
  if (!Number.isSafeInteger(upperExclusive) || upperExclusive <= 0) {
    throw new Error("Random range must be a positive integer.")
  }

  const maximum = 2 ** 32
  const unbiasedLimit = maximum - (maximum % upperExclusive)
  const value = new Uint32Array(1)

  do {
    crypto.getRandomValues(value)
  } while (value[0] >= unbiasedLimit)

  return value[0] % upperExclusive
}

export function generatePassword(
  options: PasswordOptions,
  randomIndex: RandomIndex = secureRandomIndex
): string {
  if (
    !Number.isSafeInteger(options.length) ||
    options.length < PASSWORD_LENGTH_MIN ||
    options.length > PASSWORD_LENGTH_MAX
  ) {
    throw new Error(
      `Password length must be between ${PASSWORD_LENGTH_MIN} and ${PASSWORD_LENGTH_MAX}.`
    )
  }

  const selectedSets = (
    Object.keys(PASSWORD_CHARACTER_SETS) as Array<
      keyof typeof PASSWORD_CHARACTER_SETS
    >
  )
    .filter((name) => options[name])
    .map((name) => PASSWORD_CHARACTER_SETS[name])

  if (selectedSets.length === 0) {
    throw new Error("Select at least one character type.")
  }

  if (options.length < selectedSets.length) {
    throw new Error(
      "Password length is too short for the selected character types."
    )
  }

  const characters = selectedSets.map((set) => set[randomIndex(set.length)])
  const combinedSet = selectedSets.join("")

  while (characters.length < options.length) {
    characters.push(combinedSet[randomIndex(combinedSet.length)])
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1)
    ;[characters[index], characters[swapIndex]] = [
      characters[swapIndex],
      characters[index],
    ]
  }

  return characters.join("")
}

// --- Passphrases ------------------------------------------------------------

export const PASSPHRASE_WORD_COUNT_MIN = 4
export const PASSPHRASE_WORD_COUNT_MAX = 10

// Each word drawn uniformly from the 7,776-word EFF list adds log2(7776),
// about 12.9 bits.
export const PASSPHRASE_WORDLIST_SIZE = 7776
export const PASSPHRASE_BITS_PER_WORD = Math.log2(PASSPHRASE_WORDLIST_SIZE)

export const PASSPHRASE_SEPARATORS = [
  { value: "-", label: "Hyphen ( - )" },
  { value: " ", label: "Space" },
  { value: ".", label: "Period ( . )" },
  { value: "_", label: "Underscore ( _ )" },
  { value: ",", label: "Comma ( , )" },
  { value: "", label: "None" },
] as const

export type PassphraseSeparator =
  (typeof PASSPHRASE_SEPARATORS)[number]["value"]

export interface PassphraseOptions {
  wordCount: number
  separator: PassphraseSeparator
  capitalize: boolean
  includeNumber: boolean
}

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  wordCount: 5,
  separator: "-",
  capitalize: false,
  includeNumber: false,
}

let wordlistRequest: Promise<readonly string[]> | null = null

// Loads the EFF word list on first use, so it stays out of the main bundle.
export function loadPassphraseWords(): Promise<readonly string[]> {
  wordlistRequest ??= import("./eff-large-wordlist").then(
    (module) => module.EFF_LARGE_WORDLIST,
    (error: unknown) => {
      wordlistRequest = null
      throw error
    }
  )
  return wordlistRequest
}

export function generatePassphrase(
  options: PassphraseOptions,
  words: readonly string[],
  randomIndex: RandomIndex = secureRandomIndex
): string {
  if (
    !Number.isSafeInteger(options.wordCount) ||
    options.wordCount < PASSPHRASE_WORD_COUNT_MIN ||
    options.wordCount > PASSPHRASE_WORD_COUNT_MAX
  ) {
    throw new Error(
      `Word count must be between ${PASSPHRASE_WORD_COUNT_MIN} and ${PASSPHRASE_WORD_COUNT_MAX}.`
    )
  }

  if (!PASSPHRASE_SEPARATORS.some(({ value }) => value === options.separator)) {
    throw new Error("Choose a supported separator.")
  }

  if (words.length === 0) {
    throw new Error("The word list is empty.")
  }

  const chosen = Array.from({ length: options.wordCount }, () => {
    const word = words[randomIndex(words.length)]
    return options.capitalize
      ? word.charAt(0).toUpperCase() + word.slice(1)
      : word
  })

  if (options.includeNumber) {
    const position = randomIndex(chosen.length)
    chosen[position] += PASSWORD_CHARACTER_SETS.digits[randomIndex(10)]
  }

  return chosen.join(options.separator)
}
