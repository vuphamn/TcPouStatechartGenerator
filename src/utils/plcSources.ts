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
  files?: PlcSourceFile[];
  error?: string;
}

const base = (p: string) => p.split('/').pop() ?? p;

/** A POU of the PLC's sources (by its type name), with the project's enums: null when the PLC's sources have none */
export function plcPouSource(files: PlcSourceFile[], typeName: string): PouSource | null {
  const want = `${typeName}.tcpou`.toLowerCase();
  const pou = files.find((f) => base(f.path).toLowerCase() === want);
  if (!pou) return null;
  return {
    name: base(pou.path),
    content: pou.content,
    dutCandidates: files.filter((f) => /\.TcDUT$/i.test(f.path)).map((f) => ({ name: base(f.path), relativePath: f.path, content: f.content })),
  };
}

/** The POUs of the PLC's sources: name, folder */
export const plcPous = (files: PlcSourceFile[]) =>
  files
    .filter((f) => /\.TcPOU$/i.test(f.path))
    .map((f) => ({ name: base(f.path).replace(/\.TcPOU$/i, ''), folder: f.path.split('/').slice(0, -1).join('/'), path: f.path }))
    .sort((a, b) => a.name.localeCompare(b.name));
