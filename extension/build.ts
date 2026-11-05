// Builds the Chrome extension into an unpacked directory (default extension/dist).
//   EXTENSION_APP_ORIGIN=https://app.example.com bun run build:extension
//   bun extension/build.ts --outdir /some/dir
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

import { DEFAULT_APP_ORIGIN, parseAppOrigin } from "./app-origin"
import { EXTENSION_ID, EXTENSION_PUBLIC_KEY } from "./identity"

const root = import.meta.dir
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { outdir: { type: "string" } },
})
const outdir = path.resolve(values.outdir ?? path.join(root, "dist"))
const appOrigin = parseAppOrigin(
  process.env.EXTENSION_APP_ORIGIN || DEFAULT_APP_ORIGIN
)

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

const result = await Bun.build({
  entrypoints: [
    path.join(root, "src/popup.ts"),
    path.join(root, "src/background.ts"),
  ],
  outdir,
  target: "browser",
  format: "esm",
  sourcemap: "linked",
  define: { __APP_ORIGIN__: JSON.stringify(appOrigin) },
})
// Injected into a page only when the user fills a login. A classic script
// (IIFE) so injecting it again into the same page does not redeclare names.
const fillPage = await Bun.build({
  entrypoints: [path.join(root, "src/fill-page.ts")],
  outdir,
  target: "browser",
  format: "iife",
})
for (const build of [result, fillPage]) {
  if (build.success) continue
  for (const log of build.logs) console.error(log)
  process.exit(1)
}

const manifest = JSON.parse(
  await readFile(path.join(root, "manifest.json"), "utf8")
)
await writeFile(
  path.join(outdir, "manifest.json"),
  JSON.stringify(
    {
      ...manifest,
      key: EXTENSION_PUBLIC_KEY,
      // The extension may only send requests to the app it was built for.
      host_permissions: [`${appOrigin}/*`],
    },
    null,
    2
  ) + "\n"
)
for (const file of ["popup.html", "popup.css"])
  await copyFile(path.join(root, "src", file), path.join(outdir, file))

const shown = path.relative(process.cwd(), outdir)
console.log(
  `Built the extension in ${shown.startsWith("..") ? outdir : shown || "."}\n` +
    `  app origin:       ${appOrigin}\n` +
    `  extension origin: chrome-extension://${EXTENSION_ID}`
)
