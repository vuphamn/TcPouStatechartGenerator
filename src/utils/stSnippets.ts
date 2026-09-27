/**
 * Snippets for the code editors: a word and Tab puts in a piece of code (indented like its line, the caret at $1).
 * The built-in ones, and your own (kept in this browser, set with the command palette's "Edit snippets").
 */

export interface Snippet {
  key: string;
  body: string;
  description: string;
}

export const BUILTIN_SNIPPETS: Snippet[] = [
  { key: 'if', body: 'IF $1 THEN\n\t\nEND_IF', description: 'IF … THEN … END_IF' },
  { key: 'ife', body: 'IF $1 THEN\n\t\nELSE\n\t\nEND_IF', description: 'IF … ELSE … END_IF' },
  { key: 'elsif', body: 'ELSIF $1 THEN\n\t', description: 'ELSIF … THEN' },
  { key: 'case', body: 'CASE $1 OF\n\t:\n\t\t\nEND_CASE', description: 'CASE … OF … END_CASE' },
  { key: 'for', body: 'FOR $1 := 0 TO 9 DO\n\t\nEND_FOR', description: 'FOR … DO … END_FOR' },
  { key: 'while', body: 'WHILE $1 DO\n\t\nEND_WHILE', description: 'WHILE … DO … END_WHILE' },
  { key: 'repeat', body: 'REPEAT\n\t$1\nUNTIL \nEND_REPEAT', description: 'REPEAT … UNTIL … END_REPEAT' },
  { key: 'ton', body: 'fbTimer(IN := $1, PT := T#1S);\nIF fbTimer.Q THEN\n\t\nEND_IF', description: 'a TON called, its Q checked' },
  { key: 'rtrig', body: 'fbTrig(CLK := $1);\nIF fbTrig.Q THEN\n\t\nEND_IF', description: 'an R_TRIG called, its Q checked' },
  { key: 'trans', body: 'IF $1 THEN\n\tmachineState := ;\nEND_IF', description: 'a transition: IF … THEN machineState := … END_IF' },
  { key: 'entry', body: 'IF bFirstPass THEN\n\t$1\nEND_IF', description: 'the entry action: IF bFirstPass THEN … END_IF' },
  { key: 'exit', body: 'IF machineState <> $1 THEN\n\t\nEND_IF', description: 'the exit action: IF machineState <> STATE THEN … END_IF' },
];

const KEY = 'kss.snippets';

/** Your own snippets (a key and its body), kept in this browser */
export function userSnippets(): Snippet[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((s) => s && typeof s.key === 'string' && typeof s.body === 'string').map((s) => ({ key: s.key, body: s.body, description: s.description || 'your snippet' })) : [];
  } catch {
    return [];
  }
}

export function setUserSnippets(list: Snippet[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // (not kept)
  }
}

/** The snippet for a word (yours first, then the built-in ones) */
export function snippetFor(word: string): Snippet | undefined {
  const w = word.toLowerCase();
  return userSnippets().find((s) => s.key.toLowerCase() === w) ?? BUILTIN_SNIPPETS.find((s) => s.key === w);
}

/** The text to insert: each line after the first indented like the line it starts on; the caret's offset in it */
export function expandSnippet(s: Snippet, indent: string): { text: string; caret: number } {
  const lines = s.body.split('\n');
  const text = lines.map((l, i) => (i === 0 ? l : indent + l)).join('\n');
  const caret = text.indexOf('$1');
  return { text: text.replace('$1', ''), caret: caret < 0 ? text.length : caret };
}

/** The snippets as the text to edit (key, then its body indented, a blank line between) */
export function snippetsToText(list: Snippet[]): string {
  return list.map((s) => `${s.key}${s.description && s.description !== 'your snippet' ? ` // ${s.description}` : ''}\n${s.body.split('\n').map((l) => `    ${l}`).join('\n')}`).join('\n\n');
}

/** Back from the text: a line without indentation starts a snippet ("key // description"), its body is indented by 4 */
export function snippetsFromText(text: string): Snippet[] | string {
  const out: Snippet[] = [];
  let cur: Snippet | null = null;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    // (a line of only spaces / a tab after the 4: a line of the snippet; else a separator)
    if (!raw.trim() && !/^( {4}|\t)./.test(raw)) {
      if (cur) cur.body += '\n';
      continue;
    }
    if (!/^\s/.test(raw)) {
      const m = raw.match(/^([A-Za-z_]\w*)\s*(?:\/\/\s*(.*))?$/);
      if (!m) return `"${raw.trim()}": a snippet starts with its key (letters, digits, _)`;
      cur = { key: m[1], body: '', description: m[2]?.trim() || 'your snippet' };
      out.push(cur);
      continue;
    }
    if (!cur) return 'The first line is a snippet\'s key';
    cur.body += (cur.body && !cur.body.endsWith('\n') ? '\n' : '') + raw.replace(/^ {4}|^\t/, '');
  }
  for (const s of out) s.body = s.body.replace(/\n+$/, '');
  return out;
}
