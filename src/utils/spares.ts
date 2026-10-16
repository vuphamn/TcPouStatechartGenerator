import type { SparePart } from '../components/WorkParts.tsx';

/** What a part fits, as words to find: its "fits" split at commas and semicolons (two letters at least) */
export const fitsTokens = (fits: string) =>
  String(fits ?? '')
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 2);

/**
 * The spare parts that fit a device: those whose "fits" names a word of its texts (its name, its type, its maker's
 * product: "i550" fits "Inverter i550 Cabinet"); the ones in stock first
 */
export function sparesFor(parts: SparePart[], ...texts: (string | null | undefined)[]): SparePart[] {
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  if (!hay) return [];
  return parts.filter((p) => fitsTokens(p.fits).some((t) => hay.includes(t))).sort((a, b) => Number(b.qty > 0) - Number(a.qty > 0) || a.number.localeCompare(b.number));
}
