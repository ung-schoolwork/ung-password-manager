import { fetchSession, isExtensionRequest } from "./api"
import { APP_ORIGIN } from "./config"

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own pages may use the service worker's session.
  if (sender.id !== chrome.runtime.id || !isExtensionRequest(message))
    return false
  void fetchSession(APP_ORIGIN).then(sendResponse)
  return true // keeps the channel open for the async response
})
