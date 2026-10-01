// Types of shared/ioTreeParse.mjs (the page imports it; Node's side: shared/tcIoTree.cjs)
import type { IoTree } from '../src/components/IoTreePanel.tsx';

export function productOf(name: string): string;
export function portAOf(info: string | null | undefined): { box?: number; port: number; master?: boolean } | null;
export function parseIoTreeWith(files: Record<string, string>, parseXml: (text: string) => Document): Pick<IoTree, 'devices' | 'links'>;
export const IO_FILE: RegExp;
