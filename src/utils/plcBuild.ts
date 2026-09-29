/**
 * The PLC's project rebuilt with the POUs edited here, and written back (shared/tcBuild.cjs through the desktop app,
 * Link or the gateway): what is sent, what comes back, where a message points.
 */

/** Online change (the PLC keeps running), or the whole configuration activated (TwinCAT restarts) */
export type PlcWrite = 'online' | 'activate';

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
  /** After a write: the PLC read again (its code the one written?) */
  verified?: { ok: boolean; text: string };
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
