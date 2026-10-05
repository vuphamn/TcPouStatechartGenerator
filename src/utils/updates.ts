/**
 * Updates (desktop app, XAE extension): the newest release of this edition on GitHub (tags desktop-v*, xae-v*, as
 * the Release workflow makes them) against the running version. Checked once a day at start (quietly), or from the
 * Window menu. A private repository needs a GitHub token (read access to its contents); it is kept in this app only.
 * The web edition is updated with its gateway.
 */

import { isXaeHost, onHostMessage, postToHost } from './xaeHost.ts';

export const DEFAULT_REPO = 'vuphamn/TcPouStatechartGenerator';
const SETTINGS = 'kss.update';

export interface UpdateSettings {
  repo: string;
  token: string;
  /** Last quiet check (ms) */
  lastCheck?: number;
  /** A version the user said "later" to (not shown again until a newer one) */
  skipped?: string;
  /** Update now quietly: the installer without its pages, the app started again (desktop) */
  quiet?: boolean;
}

export function loadUpdateSettings(): UpdateSettings {
  try {
    return { repo: DEFAULT_REPO, token: '', ...(JSON.parse(localStorage.getItem(SETTINGS) || '{}') as Partial<UpdateSettings>) };
  } catch {
    return { repo: DEFAULT_REPO, token: '' };
  }
}

export function saveUpdateSettings(s: UpdateSettings): void {
  try {
    localStorage.setItem(SETTINGS, JSON.stringify(s));
  } catch {
    // per-viewer convenience only
  }
}

/** This edition and its version (desktop: the app's; XAE: the extension's); null in the web edition */
export async function appInfo(): Promise<{ edition: 'desktop' | 'xae'; version: string; installable?: boolean; releasesUrl?: string } | null> {
  if (isXaeHost()) {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        off();
        resolve(null);
      }, 5000);
      const off = onHostMessage((m) => {
        const msg = m as unknown as { type: string; version?: string };
        if (msg.type !== 'hostInfo' || !msg.version) return;
        window.clearTimeout(timer);
        off();
        resolve({ edition: 'xae', version: msg.version });
      });
      postToHost({ type: 'hostInfo' } as unknown as Parameters<typeof postToHost>[0]);
    });
  }
  const d = (window as unknown as { tcDesktop?: { appInfo?: () => Promise<{ version: string; installable?: boolean; releasesUrl?: string }> } }).tcDesktop;
  if (d?.appInfo) {
    const i = await d.appInfo().catch(() => null);
    return i?.version ? { edition: 'desktop', version: i.version, installable: !!i.installable, ...(i.releasesUrl ? { releasesUrl: i.releasesUrl } : {}) } : null;
  }
  return null;
}

const parse = (v: string) => v.split('.').map((n) => Number(n) || 0);
export const newerThan = (a: string, b: string) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

export type UpdateResult =
  | { state: 'newer'; version: string; url: string; name: string; notes: string }
  | { state: 'current'; version: string }
  | { state: 'no-access'; message: string }
  | { state: 'error'; message: string };

/** Update now (an installed desktop app): its release's installer downloaded, checked and started; the app closes */
export async function installDesktopUpdate(version: string, settings: UpdateSettings): Promise<{ ok: boolean; message: string }> {
  const d = (window as unknown as { tcDesktop?: { installUpdate?: (req: { repo: string; token?: string; version: string; quiet?: boolean }) => Promise<{ ok: boolean; message: string }> } }).tcDesktop;
  if (!d?.installUpdate) return { ok: false, message: 'Update the app by hand: this one cannot install its update' };
  return d.installUpdate({ repo: settings.repo, token: settings.token || undefined, version, quiet: !!settings.quiet }).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
}

/** The newest release of the edition, against the current version (releasesUrl: the tests' stand-in for GitHub's) */
export async function checkForUpdate(edition: 'desktop' | 'xae', current: string, settings: UpdateSettings, releasesUrl?: string): Promise<UpdateResult> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (settings.token) headers.Authorization = `Bearer ${settings.token}`;
  let res: Response;
  try {
    res = await fetch(releasesUrl || `https://api.github.com/repos/${settings.repo}/releases?per_page=50`, { headers, cache: 'no-store' });
  } catch (err) {
    return { state: 'error', message: `Could not reach GitHub: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    return { state: 'no-access', message: settings.token ? `The token has no access to ${settings.repo} (${res.status})` : `${settings.repo} is private (or not there): a GitHub token is needed` };
  }
  if (!res.ok) return { state: 'error', message: `GitHub answered ${res.status}` };
  const list = (await res.json()) as { tag_name: string; name: string; html_url: string; body?: string; draft: boolean; prerelease: boolean }[];
  const mine = list
    .filter((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(`${edition}-v`))
    .map((r) => ({ ...r, version: r.tag_name.slice(edition.length + 2) }))
    .sort((a, b) => (newerThan(a.version, b.version) ? -1 : 1));
  const top = mine[0];
  if (!top || !newerThan(top.version, current)) return { state: 'current', version: current };
  return { state: 'newer', version: top.version, url: top.html_url, name: top.name, notes: (top.body ?? '').slice(0, 2000) };
}
