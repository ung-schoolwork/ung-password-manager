import { describe, expect, it } from "bun:test"

import {
  importReadyMessage,
  importSkippedMessage,
} from "../../../lib/vault/import-messages"

describe("import messages", () => {
  it("uses singular and plural forms for ready rows", () => {
    expect(importReadyMessage(1, 1)).toBe("1 of 1 row is ready to import.")
    expect(importReadyMessage(1, 3)).toBe("1 of 3 rows is ready to import.")
    expect(importReadyMessage(2, 3)).toBe("2 of 3 rows are ready to import.")
  })

  it("uses singular and plural forms for rows that need attention", () => {
    expect(importSkippedMessage(1)).toBe(
      "1 needs attention and will be skipped."
    )
    expect(importSkippedMessage(2)).toBe(
      "2 need attention and will be skipped."
    )
  })
})
