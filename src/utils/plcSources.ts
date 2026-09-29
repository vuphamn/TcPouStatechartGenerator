/**
 * The PLC project's sources as the PLC keeps them (read over ADS by the desktop app, Link or the gateway from the
 * PLC's boot folder: the project downloaded with its sources): a POU of them opened like one picked from the disk,
 * the project's enums offered for its states.
 */
import type { PouSource } from './sourceFileAccess.ts';

export interface PlcSourceFile {
  /** Its path in the PLC project (POUs/Commander3/TableManager/SM_TableManager.TcPOU) */
  path: string;
  content: string;
}

export interface PlcSources {
  project?: string;
  plcProject?: string;
  /** The PLC projects on the target (several PLCs: one per ADS port) */
  projects?: { name: string; port: number | null }[];
  files?: PlcSourceFile[];
  /** The library of each library type the project uses (lower-case type name: library, e.g. mc_power: Tc2_MC2) */
  libraryTypes?: Record<string, string>;
  /** The sources are older than the running code (a type of them differs from the PLC's) */
  stale?: string;
  error?: string;
}

const base = (p: string) => p.split('/').pop() ?? p;

/** A POU of the PLC's sources (by its type name), with the project's enums: null when the PLC's sources have none */
export function plcPouSource(files: PlcSourceFile[], typeName: string, from?: { project?: string; plcProject?: string; target?: string }): PouSource | null {
  const want = `${typeName}.tcpou`.toLowerCase();
  const pou = files.find((f) => base(f.path).toLowerCase() === want);
  if (!pou) return null;
  const duts = files.filter((f) => /\.TcDUT$/i.test(f.path));
  return {
    name: base(pou.path),
    content: pou.content,
    dutCandidates: duts.map((f) => ({ name: base(f.path), relativePath: f.path, content: f.content })),
    plc: { project: from?.project, plcProject: from?.plcProject, path: pou.path, dutPaths: Object.fromEntries(duts.map((f) => [base(f.path).toLowerCase(), f.path])), target: from?.target },
  };
}

/** The PLC's sources as a project's files (code help: their types, GVLs, POUs) */
export const plcProjectFiles = (files: PlcSourceFile[]) => files.map((f) => ({ name: base(f.path), path: f.path, content: f.content }));

/** The POUs of the PLC's sources: name, folder */
export const plcPous = (files: PlcSourceFile[]) =>
  files
    .filter((f) => /\.TcPOU$/i.test(f.path))
    .map((f) => ({ name: base(f.path).replace(/\.TcPOU$/i, ''), folder: f.path.split('/').slice(0, -1).join('/'), path: f.path }))
    .sort((a, b) => a.name.localeCompare(b.name));
