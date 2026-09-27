/**
 * CSV exports (state times, trends, availability): comma-separated, quoted where needed, CRLF lines (Excel reads
 * it). Saved with a save dialog (XAE, desktop) or downloaded (web).
 */

import { saveDocument } from './projectFiles.ts';

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export async function downloadCsv(name: string, csv: string): Promise<void> {
  await saveDocument(name.replace(/[^\w.[\]-]+/g, '_'), csv);
}
