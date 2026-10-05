/**
 * CSV exports (state times, trends, availability): comma-separated, quoted where needed, CRLF lines (Excel reads
 * it). Saved with a save dialog (XAE, desktop) or downloaded (web).
 */

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export async function downloadCsv(name: string, csv: string): Promise<void> {
  // (loaded when saving: toCsv stays free of the page's file access, for code that only builds the text)
  const { saveDocument } = await import('./projectFiles.ts');
  await saveDocument(name.replace(/[^\w.[\]-]+/g, '_'), csv);
}
