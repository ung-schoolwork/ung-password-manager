import { afterAll, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { EXTENSION_PUBLIC_KEY } from "../../../extension/identity"
import { packageExtension } from "../../../extension/package"
import { crc32, createZip } from "../../../extension/zip"
import { readZip } from "../../support/read-zip"

const outDir = mkdtempSync(path.join(tmpdir(), "ung-extension-zip-test-"))
afterAll(() => rmSync(outDir, { recursive: true, force: true }))

describe("extension zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926)
  })

  it("writes entries that read back unchanged", () => {
    const entries = [
      { name: "manifest.json", data: new TextEncoder().encode('{"a":1}\n') },
      { name: "icons/icon.png", data: new Uint8Array([0, 1, 2, 255]) },
      { name: "empty.txt", data: new Uint8Array() },
    ]
    const zip = createZip(entries)
    const files = readZip(zip)
    expect([...files.keys()]).toEqual(entries.map((entry) => entry.name))
    for (const entry of entries)
      expect(new Uint8Array(files.get(entry.name)!)).toEqual(entry.data)
    // The same files always give the same bytes.
    expect(createZip(entries).equals(zip)).toBe(true)
  })
})

describe("extension download package", () => {
  it("builds the extension for the given origin with the pinned key", async () => {
    const outFile = path.join(outDir, "nested", "extension.zip")
    const result = await packageExtension({
      appOrigin: "https://passwords.example.test",
      outFile,
    })
    expect(result.appOrigin).toBe("https://passwords.example.test")

    const files = readZip(readFileSync(outFile))
    for (const name of [
      "manifest.json",
      "popup.html",
      "popup.js",
      "background.js",
      "fill-page.js",
      "icons/icon-128.png",
    ])
      expect(files.has(name)).toBe(true)
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"))
    expect(manifest.key).toBe(EXTENSION_PUBLIC_KEY)
    expect(manifest.host_permissions).toEqual([
      "https://passwords.example.test/*",
    ])
    expect(files.get("popup.js")!.toString("utf8")).toContain(
      "https://passwords.example.test"
    )
  })

  it("refuses an origin the extension could not use", async () => {
    for (const appOrigin of [
      "http://passwords.example.test",
      "https://passwords.example.test/",
    ])
      await expect(
        packageExtension({
          appOrigin,
          outFile: path.join(outDir, "refused.zip"),
        })
      ).rejects.toThrow()
  })
})
