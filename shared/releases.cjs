// Releases on GitHub: the newest of an edition (tagged <edition>-v<version>) with its file, and that file downloaded
// and checked against the size and SHA-256 GitHub gives for it (Link updating itself, the desktop app's Update now)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_REPO = 'vuphamn/TcPouStatechartGenerator';
const releasesUrl = (repo = DEFAULT_REPO) => `https://api.github.com/repos/${repo}/releases?per_page=30`;

/** 1.2.10 against 1.2.9: > 0 when a is newer */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

const headers = (agent, token, accept = 'application/vnd.github+json') => ({ 'User-Agent': agent, Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) });

/**
 * The newest release of an edition with its file (version: that release only): { url, tagPrefix ('web', 'desktop'),
 * asset (its file's name), agent, token? (a private repository) } → { version, tag, url, apiUrl, size, sha256, page } or
 * null (none)
 */
async function latestRelease({ url, tagPrefix, asset, agent, token, version }) {
  const r = await fetch(url, { headers: headers(agent, token), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const list = await r.json();
  const tag = new RegExp(`^${tagPrefix}-v(\\d+\\.\\d+\\.\\d+)$`);
  let best = null;
  for (const rel of Array.isArray(list) ? list : []) {
    if (rel.draft || rel.prerelease) continue;
    const m = tag.exec(rel.tag_name ?? '');
    const file = (rel.assets ?? []).find((a) => asset.test(a.name ?? ''));
    if (!m || !file || (version && m[1] !== version)) continue;
    if (!best || compareVersions(m[1], best.version) > 0) {
      best = {
        version: m[1], tag: rel.tag_name, url: file.browser_download_url, apiUrl: file.url, size: file.size,
        sha256: /^sha256:([0-9a-f]{64})$/i.exec(file.digest ?? '')?.[1]?.toLowerCase() ?? null, page: rel.html_url,
      };
    }
  }
  return best;
}

/**
 * The release's file downloaded (a private repository's through the API, with its token), its size and SHA-256
 * checked, written to the temp folder as name: its path
 */
async function download(rel, { agent, token, name }) {
  if (!rel.sha256) throw new Error('The release gives no SHA-256 for its file: download it by hand');
  const r = token && rel.apiUrl
    ? await fetch(rel.apiUrl, { headers: headers(agent, token, 'application/octet-stream'), signal: AbortSignal.timeout(10 * 60000) })
    : await fetch(rel.url, { headers: { 'User-Agent': agent }, signal: AbortSignal.timeout(10 * 60000) });
  if (!r.ok) throw new Error(`The download answered ${r.status}`);
  const data = Buffer.from(await r.arrayBuffer());
  if (Number.isFinite(rel.size) && data.length !== rel.size) throw new Error(`The download is ${data.length} bytes, not ${rel.size}`);
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  if (sha !== rel.sha256) throw new Error('The download does not match the release\'s SHA-256: not used');
  const file = path.join(os.tmpdir(), name);
  fs.writeFileSync(file, data);
  return file;
}

module.exports = { DEFAULT_REPO, releasesUrl, compareVersions, latestRelease, download };
