/**
 * Who last changed each line of a method (the Method Editor's Blame): git blame of the .TcPOU (a line each of the file,
 * as on disk) matched to the method's code: its <ST><![CDATA[ in the file gives where its lines start. A line not as
 * on disk (edited here, not saved) or not committed yet says so.
 */
import type { BlameLine } from './xaeHost.ts';

export interface BlameMark {
  hash: string;
  /** 0 (the oldest commit in the method) … 1 (the newest); null: not committed / changed here */
  age: number | null;
  title: string;
}

/**
 * The method's lines (1-based, its code as shown; method '': the POU's body) → their marks; { error } when it is not in
 * the file
 */
export function methodBlame(blame: BlameLine[], method: string, code: string): Map<number, BlameMark> | { error: string } {
  const file = blame.map((b) => b.text);
  const esc = method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const at = method ? file.findIndex((l) => new RegExp(`<Method\\b[^>]*\\bName="${esc}"`, 'i').test(l)) : file.findIndex((l) => /<POU\b/i.test(l));
  const what = method ? `${method}()` : "The POU's body";
  if (at < 0) return { error: `${what} is not in the committed file (saved?)` };
  let start = -1;
  for (let i = at; i < file.length; i++) {
    if (file[i].includes('<ST><![CDATA[')) {
      start = i;
      break;
    }
    if (method ? /<\/Method>/i.test(file[i]) : /<(Method|Action|Property)\b|<\/POU>/i.test(file[i])) break;
  }
  if (start < 0) return { error: `${what} has no Structured Text in the file` };
  const lines = code.split(/\r?\n/);
  const dated = blame.filter((b) => !/^0+$/.test(b.hash)).map((b) => b.date).sort();
  const oldest = dated[0] ?? '';
  const newest = dated[dated.length - 1] ?? '';
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) || 0;
  const span = Math.max(1, day(newest) - day(oldest));
  const out = new Map<number, BlameMark>();
  for (let k = 0; k < lines.length; k++) {
    const b = blame[start + k];
    if (!b) break;
    let text = b.text;
    if (k === 0) text = text.slice(text.indexOf('<![CDATA[') + 9);
    const end = text.indexOf(']]>');
    if (end >= 0) text = text.slice(0, end);
    if (text.trimEnd() !== lines[k].trimEnd()) {
      out.set(k + 1, { hash: '', age: null, title: 'Changed here: not saved yet' });
      continue;
    }
    if (/^0+$/.test(b.hash)) {
      out.set(k + 1, { hash: b.hash, age: null, title: 'Not committed yet' });
      continue;
    }
    out.set(k + 1, { hash: b.hash, age: (day(b.date) - day(oldest)) / span, title: `${b.hash} · ${b.author} · ${b.date}\n${b.summary}` });
    if (end >= 0) break;
  }
  return out;
}
