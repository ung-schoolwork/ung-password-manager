// Builds the extension for this app's origin and zips it into public/, so the
// site offers a download that talks to the same site that served it.
//   bun extension/package.ts          (part of `bun run build`; fails on error)
//   bun extension/package.ts --dev    (part of `bun run dev`; warns instead)
// The origin comes from APP_ORIGIN at build time, the same setting the server
// checks requests against, and falls back to http://localhost:3000 when unset.
// It needs no database or network access, so it runs in any build stage.
import { spawnSync } from "node:child_process"
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"

import { DEFAULT_APP_ORIGIN, parseAppOrigin } from "./app-origin"
import { EXTENSION_DOWNLOAD_PATH } from "./download"
import { createZip } from "./zip"

const root = import.meta.dir

export const DEFAULT_DOWNLOAD_PATH = path.join(
  root,
  "..",
  "public",
  ...EXTENSION_DOWNLOAD_PATH.split("/")
)

export async function packageExtension({
  appOrigin,
  outFile,
}: {
  appOrigin: string
  outFile: string
}) {
  const origin = parseAppOrigin(appOrigin)
  const buildDir = await mkdtemp(path.join(tmpdir(), "ung-extension-package-"))
  try {
    const build = spawnSync(
      process.execPath,
      [path.join(root, "build.ts"), "--outdir", buildDir],
      {
        env: { ...process.env, EXTENSION_APP_ORIGIN: origin },
        encoding: "utf8",
      }
    )
    if (build.status !== 0)
      throw new Error(
        `Extension build failed:\n${build.stderr || build.stdout}`
      )

    const names = (
      await readdir(buildDir, { recursive: true, withFileTypes: true })
    )
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path
          .relative(buildDir, path.join(entry.parentPath, entry.name))
          .split(path.sep)
          .join("/")
      )
      .sort()
    // Files sit at the top of the archive, so unzipping on Windows or macOS
    // gives one folder with manifest.json inside, ready for "Load unpacked".
    const zip = createZip(
      await Promise.all(
        names.map(async (name) => ({
          name,
          data: await readFile(path.join(buildDir, name)),
        }))
      )
    )
    await mkdir(path.dirname(outFile), { recursive: true })
    await writeFile(outFile, zip)
    return { appOrigin: origin, outFile, bytes: zip.length }
  } finally {
    await rm(buildDir, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { dev: { type: "boolean" }, out: { type: "string" } },
  })
  const outFile = path.resolve(values.out ?? DEFAULT_DOWNLOAD_PATH)
  // Read at build time: a Docker image needs APP_ORIGIN as a build argument,
  // not only as a runtime variable, or its download points at localhost.
  if (!process.env.APP_ORIGIN && !values.dev)
    console.warn(
      `APP_ORIGIN is not set, so the extension download is built for ${DEFAULT_APP_ORIGIN}. ` +
        "Set APP_ORIGIN when building for a deployed site."
    )
  try {
    const result = await packageExtension({
      appOrigin: process.env.APP_ORIGIN || DEFAULT_APP_ORIGIN,
      outFile,
    })
    console.log(
      `Packaged the extension for ${result.appOrigin} (${result.bytes} bytes)\n` +
        `  ${path.relative(process.cwd(), result.outFile)}`
    )
  } catch (error) {
    // Never leave a download built for a different origin behind.
    await rm(outFile, { force: true })
    const message = `Could not package the extension for APP_ORIGIN: ${
      error instanceof Error ? error.message : String(error)
    }`
    if (!values.dev) {
      console.error(message)
      process.exit(1)
    }
    console.warn(`Skipped the extension download: ${message}`)
  }
}
