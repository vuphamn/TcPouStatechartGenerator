/**
 * The composites' colour: a preset for all of them (Composites: next to Theme), and a composite's own from
 * "// @color <preset or #hex>" on its {region} line in the enum (its menu's Colour…). None of them is a colour the
 * canvas uses for its marks: sky blue is hover and selection, amber the selected badge, emerald live, violet paths.
 */

export type CompositePreset = 'sand' | 'slate' | 'rose' | 'olive' | 'plain';

export const COMPOSITE_PRESETS: { id: CompositePreset; label: string }[] = [
  { id: 'sand', label: 'sand' },
  { id: 'slate', label: 'slate' },
  { id: 'rose', label: 'rose' },
  { id: 'olive', label: 'olive' },
  // (no colour of its own: the theme's look)
  { id: 'plain', label: 'plain' },
];

// (line, title) on the dark theme and on the light ones
const PALETTE: Record<Exclude<CompositePreset, 'plain'>, { dark: [string, string]; light: [string, string] }> = {
  sand: { dark: ['#c8b88a', '#d9cba0'], light: ['#8a6d1f', '#6b5416'] },
  slate: { dark: ['#94a3b8', '#cbd5e1'], light: ['#64748b', '#334155'] },
  rose: { dark: ['#e8a0b4', '#f2c4d0'], light: ['#a3405e', '#7f2945'] },
  olive: { dark: ['#a8b878', '#c4d19a'], light: ['#5f6f2a', '#46521e'] },
};

export const isCompositePreset = (c: string): c is CompositePreset => COMPOSITE_PRESETS.some((p) => p.id === c);

const HEX_RX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A colour as written after @color (a preset's name or #rgb / #rrggbb); null: neither */
export function normalizeCompositeColor(c: string): string | null {
  const v = c.trim().toLowerCase();
  return isCompositePreset(v) || HEX_RX.test(v) ? v : null;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.length === 4 ? hex.slice(1).split('').map((x) => x + x).join('') : hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** The border, title and tint of a colour (a hex: its own for both; its title the same); null: plain */
export function compositeColors(color: string, dark: boolean): { line: string; title: string; tint: string } | null {
  let line: string;
  let title: string;
  if (HEX_RX.test(color)) {
    line = color;
    title = color;
  } else if (color in PALETTE) {
    [line, title] = PALETTE[color as keyof typeof PALETTE][dark ? 'dark' : 'light'];
  } else return null;
  const [r, g, b] = rgb(line);
  return { line, title, tint: `rgba(${r}, ${g}, ${b}, 0.06)` };
}
