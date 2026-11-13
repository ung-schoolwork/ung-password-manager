// Summary lines for the CSV import dialog, with singular and plural forms.

export function importReadyMessage(okCount: number, rowCount: number) {
  const rows = rowCount === 1 ? "row" : "rows"
  const verb = okCount === 1 ? "is" : "are"
  return `${okCount} of ${rowCount} ${rows} ${verb} ready to import.`
}

export function importSkippedMessage(issueCount: number) {
  return issueCount === 1
    ? "1 needs attention and will be skipped."
    : `${issueCount} need attention and will be skipped.`
}
