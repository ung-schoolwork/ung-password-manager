// Where the site serves the packaged extension (see extension/package.ts).
export const EXTENSION_DOWNLOAD_FILE = "ung-password-manager-extension.zip"
export const EXTENSION_DOWNLOAD_PATH = `/downloads/${EXTENSION_DOWNLOAD_FILE}`
/** The folder name Windows and macOS give the unzipped download. */
export const EXTENSION_FOLDER_NAME = EXTENSION_DOWNLOAD_FILE.replace(
  /\.zip$/,
  ""
)
