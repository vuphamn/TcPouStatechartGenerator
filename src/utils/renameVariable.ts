/**
 * Renaming a variable of the POU: every use in its declaration, body, methods, properties and actions (the guards
 * too), as a whole word outside comments and strings. A member after a dot (fbX.old) and a call's named parameter
 * (fb(old := x)) are other variables and stay; THIS^.old is renamed. A method that declares a variable of that
 * name has its own: it is left as it is. A method's own variable is renamed in that method only.
 */

export interface RenameChange {
  /** "declaration", "body", "doState()", "Prop.Get", ... */
  where: string;
  /** 1-based line in that part */
  line: number;
  before: string;
  after: string;
}

export interface RenameResult {
  pou: string;
  changes: RenameChange[];
  /** Methods with a variable of their own of that name (left as they are) */
  skipped: string[];
}

const KEYWORDS = new Set(
  'IF THEN ELSE ELSIF END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT RETURN EXIT CONTINUE TRUE FALSE AND OR XOR NOT MOD VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_TEMP VAR_STAT VAR_INST VAR_GLOBAL END_VAR METHOD PROPERTY FUNCTION FUNCTION_BLOCK PROGRAM END_FUNCTION_BLOCK THIS SUPER AT'.split(' ')
);

/** Comments and strings as spaces (same length), to find code words */
function mask(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (two === '(*') {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text.startsWith('(*', j)) {
          depth++;
          j += 2;
        } else if (text.startsWith('*)', j)) {
          depth--;
          j += 2;
        } else j++;
      }
      out += text.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
    } else if (text[i] === "'" || text[i] === '"') {
      const q = text[i];
      let j = i + 1;
      while (j < text.length && text[j] !== q && text[j] !== '\n') j += text[j] === '$' ? 2 : 1;
      j = Math.min(text.length, j + 1);
      out += ' '.repeat(j - i);
      i = j;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

/**
 * The offsets of a name's uses in a text, following the rules above; after a dot too when what is before it is one
 * of `qualifiers` (an enum's type: E_States.IDLE)
 */
export function useOffsets(text: string, oldName: string, qualifiers: string[] = []): number[] {
  const q = new Set(qualifiers.map((x) => x.toLowerCase()));
  const m = mask(text);
  const rx = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  const hits: number[] = [];
  let depth = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  const parensBefore = (to: number) => {
    for (let k = last; k < to; k++) {
      if (m[k] === '(') depth++;
      else if (m[k] === ')') depth = Math.max(0, depth - 1);
    }
    last = to;
  };
  while ((match = rx.exec(m))) {
    const at = match.index;
    parensBefore(at);
    const before = m.slice(Math.max(0, at - 8), at);
    // A member of something else, unless THIS^.
    const owner = m.slice(Math.max(0, at - 80), at).match(/([A-Za-z_]\w*)\s*\.\s*$/)?.[1]?.toLowerCase();
    if (/\.\s*$/.test(before) && !/THIS\^\s*\.\s*$/i.test(before) && !(owner && q.has(owner))) continue;
    // A call's named parameter
    const after = m.slice(at + match[0].length).match(/^\s*(:=|=>)/);
    if (after && depth > 0) continue;
    hits.push(at);
  }
  return hits;
}

/** The text with the word renamed, following the rules above */
export function renameInText(text: string, oldName: string, newName: string): { text: string; count: number } {
  const hits = useOffsets(text, oldName);
  let out = text;
  for (const at of [...hits].reverse()) out = out.slice(0, at) + newName + out.slice(at + oldName.length);
  return { text: out, count: hits.length };
}

interface Section {
  /** Offsets of the CDATA text in the XML */
  start: number;
  end: number;
  kind: 'Declaration' | 'ST';
  /** The unit it belongs to: '' for the POU's own, else "Method doState" etc. */
  unit: string;
  where: string;
}

function sections(pouXml: string): Section[] {
  // The units: Method / Action / Transition / Property's Get / Set (by their element ranges)
  const units: { name: string; label: string; start: number; end: number }[] = [];
  const unitRx = /<(Method|Action|Transition|Property)\b[^>]*\bName="([^"]+)"[^>]*>/gi;
  let u: RegExpExecArray | null;
  while ((u = unitRx.exec(pouXml))) {
    const close = pouXml.indexOf(`</${u[1]}>`, u.index);
    if (close < 0) continue;
    if (u[1].toLowerCase() === 'property') {
      for (const acc of ['Get', 'Set']) {
        const a = pouXml.indexOf(`<${acc}`, u.index);
        const z = a >= 0 ? pouXml.indexOf(`</${acc}>`, a) : -1;
        if (a >= 0 && z >= 0 && z < close) units.push({ name: `${u[2]}.${acc}`, label: `${u[2]}.${acc}`, start: a, end: z });
      }
      units.push({ name: u[2], label: `${u[2]} (property)`, start: u.index, end: close });
    } else units.push({ name: u[2], label: u[1].toLowerCase() === 'method' ? `${u[2]}()` : u[2], start: u.index, end: close });
  }
  const out: Section[] = [];
  const rx = /<(Declaration|ST)>\s*<!\[CDATA\[([\s\S]*?)\]\]>/gi;
  let s: RegExpExecArray | null;
  while ((s = rx.exec(pouXml))) {
    const start = s.index + s[0].indexOf('<![CDATA[') + 9;
    const end = start + s[2].length;
    // The innermost unit around it
    const around = units.filter((x) => x.start <= s!.index && s!.index < x.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    const kind = s[1] === 'ST' ? 'ST' : 'Declaration';
    out.push({ start, end, kind, unit: around?.name ?? '', where: around ? `${around.label}${kind === 'Declaration' ? ' declaration' : ''}` : kind === 'Declaration' ? 'declaration' : 'body' });
  }
  return out;
}

/** Declares the name (a variable line in its VAR blocks) */
function declares(decl: string, name: string): boolean {
  const m = mask(decl);
  return new RegExp(`^\\s*(?:[A-Za-z_]\\w*\\s*,\\s*)*${name}\\b\\s*(?:,\\s*[A-Za-z_]\\w*\\s*)*(?:AT\\s+%\\S+\\s*)?:(?!=)`, 'im').test(m);
}

/** Why the new name cannot be used, or null */
export function checkRename(pouXml: string, oldName: string, newName: string, method?: string): string | null {
  if (!/^[A-Za-z_]\w*$/.test(newName)) return 'A name is letters, digits and _ (not starting with a digit)';
  if (KEYWORDS.has(newName.toUpperCase())) return `${newName} is a keyword`;
  if (newName.toLowerCase() === oldName.toLowerCase() && newName === oldName) return 'Enter another name';
  const secs = sections(pouXml).filter((s) => s.kind === 'Declaration' && (method ? s.unit.toLowerCase() === method.toLowerCase() || s.unit === '' : true));
  if (newName.toLowerCase() !== oldName.toLowerCase() && secs.some((s) => declares(pouXml.slice(s.start, s.end), newName))) return `${newName} is already declared`;
  return null;
}

/**
 * The POU with the variable renamed: a POU member everywhere (methods with one of their own left out), a method's
 * own (method given) in that method only
 */
export function renameVariable(pouXml: string, oldName: string, newName: string, method?: string): RenameResult | { error: string } {
  const err = checkRename(pouXml, oldName, newName, method);
  if (err) return { error: err };
  const all = sections(pouXml);
  const unitName = method?.replace(/\(\)$/, '').toLowerCase();
  const decls = new Map(all.filter((s) => s.kind === 'Declaration').map((s) => [s.unit.toLowerCase(), pouXml.slice(s.start, s.end)]));
  if (unitName ? !declares(decls.get(unitName) ?? '', oldName) : !declares(decls.get('') ?? '', oldName)) return { error: `${oldName} is not declared in ${method ? `${method}` : 'the POU'}` };
  const skipped: string[] = [];
  const targets = all.filter((s) => {
    const unit = s.unit.toLowerCase();
    if (unitName) return unit === unitName;
    // A unit with its own variable of that name keeps it (a property's accessors: the accessor's own)
    if (unit && declares(decls.get(unit) ?? '', oldName)) {
      const label = s.where.replace(/ declaration$/, '');
      if (!skipped.includes(label)) skipped.push(label);
      return false;
    }
    return true;
  });
  const changes: RenameChange[] = [];
  let out = pouXml;
  for (const s of [...targets].sort((a, b) => b.start - a.start)) {
    const text = pouXml.slice(s.start, s.end);
    const r = renameInText(text, oldName, newName);
    if (!r.count) continue;
    const before = text.split(/\r?\n/);
    const after = r.text.split(/\r?\n/);
    before.forEach((l, i) => {
      if (l !== after[i]) changes.push({ where: s.where, line: i + 1, before: l.trim(), after: after[i].trim() });
    });
    out = out.slice(0, s.start) + r.text + out.slice(s.end);
  }
  // In the order of the file
  const order = [...new Set(all.map((s) => s.where))];
  changes.sort((a, b) => order.indexOf(a.where) - order.indexOf(b.where) || a.line - b.line);
  return { pou: out, changes, skipped };
}

export interface Reference {
  /** "declaration", "body", "doState()", "doState() declaration", "Prop.Get", ... */
  where: string;
  /** The method / action / accessor (none: the POU's own declaration or body) */
  unit?: string;
  part: 'declaration' | 'implementation';
  /** 1-based line in that part */
  line: number;
  /** 0-based column of the use */
  column: number;
  text: string;
  /** Written to (name := ...), declared, or read */
  kind: 'declaration' | 'write' | 'read';
}

/**
 * Every use of a name in the POU (a variable, a state, a method): its declaration, body, methods, properties and
 * actions, as a whole word outside comments and strings (a member of something else and a named parameter left out)
 */
export function findReferences(pouXml: string, name: string, qualifiers: string[] = []): Reference[] {
  const out: Reference[] = [];
  for (const s of sections(pouXml)) {
    const text = pouXml.slice(s.start, s.end);
    const lines = text.split(/\r?\n/);
    const starts: number[] = [];
    let n = 0;
    for (const l of lines) {
      starts.push(n);
      n += l.length + (text[n + l.length] === '\r' ? 2 : 1);
    }
    for (const at of useOffsets(text, name, qualifiers)) {
      let li = starts.length - 1;
      while (li > 0 && starts[li] > at) li--;
      const lineText = lines[li];
      const col = at - starts[li];
      const rest = lineText.slice(col + name.length);
      const kind: Reference['kind'] = s.kind === 'Declaration' && /^\s*(,\s*\w+\s*)*(AT\s+%\S+\s*)?:(?!=)/i.test(rest) ? 'declaration' : /^\s*:=/.test(rest) ? 'write' : 'read';
      out.push({ where: s.where, unit: s.unit || undefined, part: s.kind === 'Declaration' ? 'declaration' : 'implementation', line: li + 1, column: col, text: lineText.trim(), kind });
    }
  }
  return out;
}

/**
 * A member of a POU renamed where other code uses it: `inst.old` (also inst[i].old, pInst^.old, GVL.inst.old) and a
 * call's named parameter `inst(old := x)`, for the instances given (the variables of that POU's type). In every
 * declaration and ST part of a file.
 */
export function renameMemberInFile(xml: string, instances: Set<string>, oldName: string, newName: string): { xml: string; changes: RenameChange[] } {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const changes: RenameChange[] = [];
  let out = xml;
  const secs = sections(xml).sort((a, b) => b.start - a.start);
  for (const s of secs) {
    const text = xml.slice(s.start, s.end);
    const m = mask(text);
    const hits: number[] = [];
    // inst.old, inst[..].old, inst^.old
    const member = new RegExp(`\\b([A-Za-z_]\\w*)\\s*(?:\\[[^\\]]*\\])?\\s*\\^?\\s*\\.\\s*(${esc(oldName)})\\b`, 'gi');
    let r: RegExpExecArray | null;
    while ((r = member.exec(m))) {
      if (!instances.has(r[1].toLowerCase())) continue;
      hits.push(r.index + r[0].length - r[2].length);
    }
    // inst(..., old := x, ...)
    const call = /\b([A-Za-z_]\w*)\s*\(/g;
    while ((r = call.exec(m))) {
      if (!instances.has(r[1].toLowerCase())) continue;
      let depth = 1;
      let i = r.index + r[0].length;
      const from = i;
      while (i < m.length && depth > 0) {
        if (m[i] === '(') depth++;
        else if (m[i] === ')') depth--;
        i++;
      }
      const inner = m.slice(from, i - 1);
      const param = new RegExp(`(^|[,(\\s])(${esc(oldName)})\\s*(:=|=>)`, 'gi');
      let q: RegExpExecArray | null;
      while ((q = param.exec(inner))) hits.push(from + q.index + q[1].length);
    }
    if (!hits.length) continue;
    let t = text;
    for (const at of [...new Set(hits)].sort((a, b) => b - a)) t = t.slice(0, at) + newName + t.slice(at + oldName.length);
    const before = text.split(/\r?\n/);
    const after = t.split(/\r?\n/);
    const here: RenameChange[] = [];
    before.forEach((l, i) => {
      if (l !== after[i]) here.push({ where: s.where, line: i + 1, before: l.trim(), after: after[i].trim() });
    });
    changes.unshift(...here);
    out = out.slice(0, s.start) + t + out.slice(s.end);
  }
  return { xml: out, changes };
}

/** A name renamed in every part of a file (a state in other POUs: also as E_X.STATE, with the enum's name given) */
export function renameWordInFile(xml: string, oldName: string, newName: string, qualifiers: string[] = []): { xml: string; changes: RenameChange[] } {
  const changes: RenameChange[] = [];
  let out = xml;
  for (const s of sections(xml).sort((a, b) => b.start - a.start)) {
    const text = xml.slice(s.start, s.end);
    const hits = useOffsets(text, oldName, qualifiers);
    if (!hits.length) continue;
    let t = text;
    for (const at of [...hits].sort((a, b) => b - a)) t = t.slice(0, at) + newName + t.slice(at + oldName.length);
    const before = text.split(/\r?\n/);
    const after = t.split(/\r?\n/);
    const here: RenameChange[] = [];
    before.forEach((l, i) => {
      if (l !== after[i]) here.push({ where: s.where, line: i + 1, before: l.trim(), after: after[i].trim() });
    });
    changes.unshift(...here);
    out = out.slice(0, s.start) + t + out.slice(s.end);
  }
  return { xml: out, changes };
}

/** Why a method / property cannot get the new name, or null */
export function checkMethodRename(pouXml: string, oldName: string, newName: string): string | null {
  if (!/^[A-Za-z_]\w*$/.test(newName)) return 'A name is letters, digits and _ (not starting with a digit)';
  if (KEYWORDS.has(newName.toUpperCase())) return `${newName} is a keyword`;
  if (newName === oldName) return 'Enter a new name';
  const taken = new RegExp(`<(Method|Property|Action)\\b[^>]*\\bName="${newName}"`, 'i').test(pouXml);
  if (taken && newName.toLowerCase() !== oldName.toLowerCase()) return `${newName} is already a method, property or action of the POU`;
  const decl = sections(pouXml).find((s) => s.kind === 'Declaration' && s.unit === '');
  if (decl && declares(pouXml.slice(decl.start, decl.end), newName)) return `${newName} is a variable of the POU`;
  return null;
}

/**
 * A method (or property, or action) of the POU renamed: its element's name, its METHOD / PROPERTY line, every call in
 * the POU (x(, THIS^.x(, its result x := inside it)
 */
export function renameMethod(pouXml: string, oldName: string, newName: string): { pou: string; changes: RenameChange[]; kind: 'method' | 'property' | 'action'; isPrivate: boolean } | { error: string } {
  const err = checkMethodRename(pouXml, oldName, newName);
  if (err) return { error: err };
  const el = pouXml.match(new RegExp(`<(Method|Property|Action)\\b[^>]*\\bName="(${oldName})"[^>]*>`, 'i'));
  if (!el) return { error: `${oldName} is no method, property or action of the POU` };
  const kind = el[1].toLowerCase() === 'method' ? 'method' : el[1].toLowerCase() === 'action' ? 'action' : 'property';
  const old = el[2];
  // Every use in the POU (its header line included: METHOD PUBLIC old : BOOL)
  const changes: RenameChange[] = [];
  let out = pouXml;
  let isPrivate = false;
  for (const s of sections(pouXml).sort((a, b) => b.start - a.start)) {
    const text = pouXml.slice(s.start, s.end);
    if (s.kind === 'Declaration' && s.unit.toLowerCase() === old.toLowerCase()) isPrivate = /^\s*(METHOD|PROPERTY)\b[^\n]*\bPRIVATE\b/im.test(text);
    const r = renameInText(text, old, newName);
    if (!r.count) continue;
    const before = text.split(/\r?\n/);
    const after = r.text.split(/\r?\n/);
    const here: RenameChange[] = [];
    before.forEach((l, i) => {
      if (l !== after[i]) here.push({ where: s.where, line: i + 1, before: l.trim(), after: after[i].trim() });
    });
    changes.unshift(...here);
    out = out.slice(0, s.start) + r.text + out.slice(s.end);
  }
  // The element's name
  out = out.replace(new RegExp(`(<${el[1]}\\b[^>]*\\bName=")${old}(")`, 'i'), `$1${newName}$2`);
  return { pou: out, changes, kind, isPrivate };
}
