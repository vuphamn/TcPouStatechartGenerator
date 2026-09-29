/**
 * Two versions of a POU compared part by part (its declaration, its body, each method, action and property
 * accessor): the lines that changed in each (Compare with the PLC)
 */
import { lineDiff } from './lineDiff.ts';
import { extractPouDeclaration } from './stSymbolDefinition.ts';
import { getActionsFromPou, getAllMethodsFromPou, getMethodCodeFromPou, getPropertyAccessorsFromPou } from './pouStateEditor.ts';
import { getPouBody } from './pouBody.ts';

export interface PartDiff {
  /** "declaration", "body", "doState()", "doState() declaration", "bReady.Get" */
  part: string;
  added: number;
  removed: number;
  rows: string[];
  /** Only on one side */
  only?: 'before' | 'after';
}

const lines = (s: string) => s.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n');

/** An enum (or another single-part file): its declaration's lines */
export function dutPartDiff(before: string, after: string): PartDiff[] {
  const decl = (x: string) => /<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/.exec(x)?.[1] ?? x;
  const a = decl(before);
  const b = decl(after);
  if (a.replace(/\r\n/g, '\n').trimEnd() === b.replace(/\r\n/g, '\n').trimEnd()) return [];
  const d = lineDiff(lines(a), lines(b));
  return [{ part: 'declaration', added: d.added, removed: d.removed, rows: d.rows }];
}

export function pouPartDiffs(before: string, after: string): PartDiff[] {
  const out: PartDiff[] = [];
  const add = (part: string, a: string | null, b: string | null) => {
    if (a === null && b === null) return;
    if (a === null || b === null) {
      out.push({ part, added: b === null ? 0 : lines(b).length, removed: a === null ? 0 : lines(a).length, rows: [], only: a === null ? 'after' : 'before' });
      return;
    }
    if (a.replace(/\r\n/g, '\n').trimEnd() === b.replace(/\r\n/g, '\n').trimEnd()) return;
    const d = lineDiff(lines(a), lines(b));
    out.push({ part, added: d.added, removed: d.removed, rows: d.rows });
  };
  add('declaration', extractPouDeclaration(before), extractPouDeclaration(after));
  add('body', getPouBody(before).implementation, getPouBody(after).implementation);
  const units = (pou: string) => [...(/<Method\b/i.test(pou) ? getAllMethodsFromPou(pou) : []), ...getActionsFromPou(pou), ...getPropertyAccessorsFromPou(pou).map((p) => p.name)];
  const names = [...new Set([...units(before), ...units(after)].map((n) => n.toLowerCase()))];
  for (const key of names.sort()) {
    const name = [...units(after), ...units(before)].find((n) => n.toLowerCase() === key)!;
    const a = getMethodCodeFromPou(before, name);
    const b = getMethodCodeFromPou(after, name);
    const label = /\.(Get|Set)$/.test(name) ? name : `${name}()`;
    add(`${label} declaration`, a.methodFound ? a.declaration : null, b.methodFound ? b.declaration : null);
    // (a unit only on one side: said once, with its declaration)
    if (a.methodFound && b.methodFound) add(label, a.code, b.code);
  }
  return out;
}
