/**
 * The builds of a project copy seen here (its _CompileInfo's newest each time the app went live): XAE keeps only the
 * latest build's compile info, so a PLC that runs another ID is an older build of this copy when that ID was seen
 * here before (with when it was built), else not known (another copy's, or built while the app was not looking).
 * Kept in this browser per project copy (the POU's folder), the newest 50.
 */

export interface SeenBuild {
  id: string;
  /** When it was built (ISO, its .compileinfo's time) */
  at: string;
}

export interface CompileInfo {
  plc: string;
  newest: { id: string; at: string } | null;
  state: 'newest' | 'older' | 'other' | null;
  builtAt: string | null;
  /** older: known from the builds seen here before (not in _CompileInfo any more) */
  seenBefore?: boolean;
}

const MAX = 50;
const keyOf = (copy: string) => `kss.builds.${copy.toLowerCase()}`;

/** The project copy a POU belongs to, as kept: its folder */
export const buildCopyOf = (pouPath: string) => pouPath.replace(/[\\/][^\\/]*$/, '');

export function loadBuilds(copy: string): SeenBuild[] {
  try {
    const list = JSON.parse(localStorage.getItem(keyOf(copy)) || '[]') as SeenBuild[];
    return Array.isArray(list) ? list.filter((b) => b && typeof b.id === 'string' && typeof b.at === 'string') : [];
  } catch {
    return [];
  }
}

/** A build seen (the copy's newest now): kept, newest first */
export function rememberBuild(copy: string, build: SeenBuild): SeenBuild[] {
  const list = loadBuilds(copy);
  const id = build.id.toUpperCase();
  if (list.some((b) => b.id.toUpperCase() === id)) return list;
  const next = [{ id, at: build.at }, ...list].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX);
  try {
    localStorage.setItem(keyOf(copy), JSON.stringify(next));
  } catch {
    // per-viewer convenience only
  }
  return next;
}

/** The PLC's build said with what was seen here: another ID seen before is an older build of this copy */
export function withSeenBuilds(c: CompileInfo, seen: SeenBuild[]): CompileInfo {
  if (c.state !== 'other' || !c.plc) return c;
  const hit = seen.find((b) => b.id.toUpperCase() === c.plc.toUpperCase());
  return hit ? { ...c, state: 'older', builtAt: hit.at, seenBefore: true } : c;
}
