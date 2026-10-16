import { randomInt } from "node:crypto"

import { expect as playwrightExpect, test as playwrightTest } from "@playwright/test"
import type { BrowserContext } from "@playwright/test"

export { playwrightExpect as expect }

export async function setTestClientIp(context: BrowserContext) {
  const ip = `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`
  await context.setExtraHTTPHeaders({ "x-e2e-client-ip": ip })
  return ip
}

export const test = playwrightTest.extend({
  context: async ({ browser, contextOptions }, run) => {
    const context = await browser.newContext(contextOptions)
    await setTestClientIp(context)
    try {
      await run(context)
    } finally {
      await context.close()
    }
  },
})
