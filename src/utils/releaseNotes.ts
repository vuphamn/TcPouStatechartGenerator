/**
 * The editions' versions and release notes (made at build time from the git history: scripts/release-plan.cjs,
 * vite.config.ts): what the status bar shows, what the Release notes dialog lists.
 */
export type EditionId = 'xae' | 'desktop' | 'web';

export interface ReleaseChange {
  /** feat, fix, ci, docs, perf, refactor, test, chore, build; change: no prefix */
  kind: string;
  text: string;
}
export interface ReleaseCommit {
  hash: string;
  date: string;
  changes: ReleaseChange[];
}
export interface EditionRelease {
  tag: string;
  version: string;
  date: string;
  commits: ReleaseCommit[];
}
export interface EditionHistory {
  title: string;
  /** The version in its files (a release build: the release's) */
  version: string;
  releases: EditionRelease[];
  /** In this build after its last release */
  unreleased: ReleaseCommit[];
}
export type ReleaseHistory = Partial<Record<EditionId, EditionHistory>> & { error?: string };

export const EDITION_LABEL: Record<EditionId, string> = { xae: 'XAE', desktop: 'Desktop', web: 'Web' };

/** This build's version of an edition */
export function editionVersion(e: EditionId): string {
  try {
    return __KSS_VERSIONS__[e] ?? '';
  } catch {
    // (no build-time versions: the unit tests)
    return '';
  }
}

/** Which edition this is, from where the app runs */
export const editionOf = (host: 'XAE' | 'Desktop' | 'Web'): EditionId => (host === 'XAE' ? 'xae' : host === 'Desktop' ? 'desktop' : 'web');

/** A release's (or the unreleased part's) changes, grouped: features, fixes, the rest; the same text once */
export function groupChanges(commits: ReleaseCommit[]): { kind: 'feat' | 'fix' | 'other'; items: ReleaseChange[] }[] {
  const seen = new Set<string>();
  const groups: Record<'feat' | 'fix' | 'other', ReleaseChange[]> = { feat: [], fix: [], other: [] };
  for (const c of commits) {
    for (const ch of c.changes) {
      const key = ch.text.toLowerCase();
      if (!ch.text || seen.has(key)) continue;
      seen.add(key);
      groups[ch.kind === 'feat' ? 'feat' : ch.kind === 'fix' ? 'fix' : 'other'].push(ch);
    }
  }
  return (['feat', 'fix', 'other'] as const).filter((k) => groups[k].length).map((k) => ({ kind: k, items: groups[k] }));
}

/** The releases whose changes mention the text (all of them for no text) */
export function filterReleases(h: EditionHistory, text: string): { unreleased: ReleaseCommit[]; releases: EditionRelease[] } {
  const q = text.trim().toLowerCase();
  if (!q) return { unreleased: h.unreleased, releases: h.releases };
  const keep = (cs: ReleaseCommit[]) => cs.map((c) => ({ ...c, changes: c.changes.filter((ch) => ch.text.toLowerCase().includes(q)) })).filter((c) => c.changes.length);
  return { unreleased: keep(h.unreleased), releases: h.releases.map((r) => ({ ...r, commits: keep(r.commits) })).filter((r) => r.commits.length) };
}
