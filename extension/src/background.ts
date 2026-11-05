import { handleRequest, isExtensionRequest } from "./api"
import { APP_ORIGIN } from "./config"

// Only this extension's own pages (the popup) may use the browser's session
// through the service worker. Content scripts also carry this extension's ID,
// so the sender's URL must be an extension page too.
const EXTENSION_PAGES = chrome.runtime.getURL("")

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(EXTENSION_PAGES) ||
    !isExtensionRequest(message)
  )
    return false
  void handleRequest(APP_ORIGIN, message).then(sendResponse)
  return true // keeps the channel open for the async response
})
