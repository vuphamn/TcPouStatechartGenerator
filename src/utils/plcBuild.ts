/**
 * The PLC's project rebuilt with the POUs edited here, and written back (shared/tcBuild.cjs through the desktop app,
 * Link or the gateway): what is sent, what comes back, where a message points.
 */

/** Online change (the PLC keeps running), or the whole configuration activated (TwinCAT restarts) */
/** Online change (the PLC keeps running); download (its application stops and starts again, TwinCAT keeps running:
 * when an online change is not possible); the whole configuration activated (TwinCAT restarts) */
export type PlcWrite = 'online' | 'download' | 'activate';

export interface PlcBuildItem {
  level: 'error' | 'warning';
  text: string;
  /** As XAE names it: <file>.TcPOU@<member> (Impl) */
  file: string;
  line: number;
  column?: number;
  project?: string;
  /** In the PLC project: its file's path there, the member (method, action, Prop.Get), the part, the line */
  place?: { plcProject: string; path: string; member: string | null; part: 'declaration' | 'implementation' | null; line: number | null } | null;
}

export interface PlcBuildResult {
  requestId?: number;
  ok: boolean;
  items?: PlcBuildItem[];
  errors?: number;
  warnings?: number;
  fatal?: string;
  written?: PlcWrite;
  plcState?: string;
  plcProject?: string;
  applied?: string[];
  /** A project build (desktop): the compile information files copied back into the project after the write */
  compileInfoCopied?: number;
  /** Its paths in the project (Link: the files themselves, compileInfo, to write into the page's project folder) */
  compileInfoFiles?: string[];
  compileInfo?: { path: string; data: string }[];
  /** XAE kept open for the next build until then (ms since 1970); the projects open in XAE */
  xaeOpenUntil?: number;
  xaeOpenProjects?: number;
  /** Each project open in XAE (its key: Close closes that one) */
  xaeOpen?: { key: string; name: string; until: number }[];
  /** After a write: the PLC application's state (ok: back in Run) */
  plcRun?: { state: string | null; ok: boolean };
  /** After a write: the PLC read again (its code the one written?) */
  verified?: { ok: boolean; text: string };
}

/** The PLC application's state and how many online changes it took (TwinCAT's OnlineChangeCnt; null: not read) */
export interface PlcAppInfo {
  state: string | null;
  onlineChanges: number | null;
  error?: string;
}

export interface PlcEdit {
  plcProject?: string;
  path: string;
  content: string;
}

/** Where a POU (and its enums) came from in the PLC's sources, to put the edits back there */
export interface PlcOrigin {
  project?: string;
  plcProject?: string;
  /** The POU's path in the PLC project */
  path: string;
  /** The .TcDUT files offered with it: lower-case file name → path */
  dutPaths: Record<string, string>;
  /** The connection it came through (netId:port) */
  target?: string;
}

const base = (p: string) => p.split('/').pop() ?? p;

/** The files to put in: the POU, and its enum when it is one of the PLC's */
export function plcEdits(origin: PlcOrigin, pou: { content: string }, dut?: { name?: string; content?: string | null }): PlcEdit[] {
  const edits: PlcEdit[] = [{ plcProject: origin.plcProject, path: origin.path, content: pou.content }];
  const dutPath = dut?.name ? origin.dutPaths[dut.name.toLowerCase()] : undefined;
  if (dutPath && dut?.content) edits.push({ plcProject: origin.plcProject, path: dutPath, content: dut.content });
  return edits;
}

/** A message's place from XAE's file name ("C:\\p\\SM_X.TcPOU@doState (Impl)"): the file (its full path), member, part */
export function placeOfXaeFile(file: string, line: number): PlcBuildItem['place'] {
  const m = /^(.*?\.Tc(?:POU|DUT|GVL|IO))(?:@([^ (]+))?(?:\s*\((Impl|Decl)\))?\s*$/i.exec(String(file || '').trim());
  if (!m) return null;
  return { plcProject: '', path: m[1].replace(/\\/g, '/'), member: m[2] ?? null, part: m[3] ? (m[3].toLowerCase() === 'decl' ? 'declaration' : 'implementation') : null, line: line || null };
}

/** "SM_X.doState() line 12", "SM_X declaration line 3", "(the project)" */
export function buildItemWhere(i: PlcBuildItem): string {
  const p = i.place;
  if (!p) return i.file ? i.file.split(/[\\/]/).pop() ?? i.file : '(the project)';
  const pou = base(p.path).replace(/\.Tc\w+$/i, '');
  const member = p.member ? `.${p.member}${/\.(Get|Set)$/.test(p.member) ? '' : '()'}` : '';
  const part = p.part === 'declaration' ? ' declaration' : '';
  return `${pou}${member}${part}${p.line ? ` line ${p.line}` : ''}`;
}

/** Is the message in this POU (its path in the PLC project)? */
export const itemInPou = (i: PlcBuildItem, origin: PlcOrigin | null) => !!origin && !!i.place && i.place.path.toLowerCase() === origin.path.toLowerCase();

/** Bytes as base64 (a project file's piece sent to Link), in slices so a large piece does not overflow the stack */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** base64 as bytes (the compile information Link sends back) */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
