/**
 * What's new: the features this build has that the one last opened here did not (the release history's feat commits
 * newer than the newest commit seen; scripts/release-plan.cjs), each with its area (the commit's scope) and its
 * description (the commit message's first paragraph). Shown once after an update; the Help palette's What's new any time.
 */
import type { EditionHistory, ReleaseCommit } from './releaseNotes.ts';

export interface WhatsNewItem {
  hash: string;
  date: string;
  /** The feature(s): the commit's feat changes */
  title: string;
  /** What it does: the commit message's first paragraph */
  body?: string;
  /** Where: its scope, said plainly (VS Code, Live, …) */
  area: string;
}

/** The newest commit seen here (the build last opened): localStorage, per viewer and edition (their histories differ) */
export const whatsNewSeenKey = (edition: string) => `kss.whatsNew.seen|${edition}`;

const AREA_LABEL: Record<string, string> = {
  vscode: 'VS Code',
  xae: 'TwinCAT XAE',
  activate: 'TwinCAT',
  twincat: 'TwinCAT',
  live: 'Live',
  editors: 'Code editors',
  editor: 'Code editors',
  canvas: 'Statechart',
  statechart: 'Statechart',
  layout: 'Layout',
  desktop: 'Desktop app',
  web: 'Web',
  link: 'Link',
  gateway: 'Gateway',
};
export const areaOf = (scope: string | undefined): string => {
  const s = (scope ?? '').trim().toLowerCase();
  if (!s) return 'MachineScope';
  return AREA_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
};

/** Every commit of an edition's history, newest first */
export const commitsOf = (h: EditionHistory): ReleaseCommit[] => [...h.unreleased, ...h.releases.flatMap((r) => r.commits)];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The features newer than the commit seen (none seen, or one no longer in the history: the latest ones) →
 * { items (newest first, at most `max`), newest (the build's newest commit), sinceSeen (seen and found) }
 */
export function whatsNew(h: EditionHistory | undefined, seen: string | null, max = 40): { items: WhatsNewItem[]; newest: string | null; sinceSeen: boolean } {
  const commits = h ? commitsOf(h) : [];
  const newest = commits[0]?.hash ?? null;
  const at = seen ? commits.findIndex((c) => c.hash === seen) : -1;
  const slice = at >= 0 ? commits.slice(0, at) : commits;
  const items: WhatsNewItem[] = [];
  for (const c of slice) {
    const feats = c.changes.filter((x) => x.kind === 'feat' && x.text);
    if (!feats.length) continue;
    items.push({ hash: c.hash, date: c.date, title: feats.map((x) => cap(x.text)).join('; '), ...(c.body ? { body: c.body } : {}), area: areaOf(feats[0].scope) });
    if (items.length >= max) break;
  }
  return { items, newest, sinceSeen: at >= 0 };
}

/**
 * Shown by itself on opening: an earlier build of this edition was opened here and this one has new features since.
 * A first start says nothing; nor does a commit not in this edition's history (another edition's, or too old to be
 * listed): what came since is not known then
 */
export function showWhatsNewOnStart(h: EditionHistory | undefined, seen: string | null): boolean {
  if (!seen || !h) return false;
  const r = whatsNew(h, seen);
  return r.sinceSeen && !!r.newest && r.newest !== seen && r.items.length > 0;
}

/** Items grouped by area, in the order the areas first come (the newest first) */
export function byArea(items: WhatsNewItem[]): { area: string; items: WhatsNewItem[] }[] {
  const out: { area: string; items: WhatsNewItem[] }[] = [];
  for (const it of items) {
    let g = out.find((x) => x.area === it.area);
    if (!g) out.push((g = { area: it.area, items: [] }));
    g.items.push(it);
  }
  return out;
}
