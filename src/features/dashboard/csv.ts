// CSV of a dashboard chart or of its cards (frontend-patterns §9: "CSV export per chart"). Figures stay the
// decimal strings of the DTO (C15), so a spreadsheet reads them without locale formatting.

function escapeCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC 4180 text with a header row and `\n` line endings. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, ...rows].map((row) => row.map(escapeCell).join(",")).join("\n") + "\n";
}

/** Starts the browser download of `content` as `filename`. */
export function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke on a later tick: Firefox can cancel the download if the URL is gone before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
