/**
 * A POU that EXTENDS another (SM_Head EXTENDS SM_3AxisHead EXTENDS KvalStateMachineBase): its state machine is partly
 * in its bases. doState() may be the base's, and its states' code in methods the POU overrides or inherits.
 *
 * mergeInherited: the bases' methods added to the POU's text for reading only, between two markers, each marked with
 * the base it comes from (KvalInheritedFrom). A method the POU (or a nearer base) overrides is added as
 * "<Base>.<name>" (what SUPER^.<name>() calls). stripInherited takes them out again: what is saved is the POU's own.
 *
 * expandStateCalls: a statement that only calls a method of the POU ("HEAD_IDLE: headIdle();", "SUPER^.preProcess();")
 * is replaced by that method's code when it (or a method it calls) sets the state variable, so its transitions are the
 * state's. The inlined code is between "{kss-in <method> <owner>}" and "{kss-out}" lines (pragmas: the parsers skip
 * them), which say where a transition is written.
 */

const START = '<!--kss-inherited';
const END = '<!--/kss-inherited-->';
const BLOCK = /<!--kss-inherited[^>]*-->[\s\S]*?<!--\/kss-inherited-->\r?\n?[ \t]*/;

export interface InheritedSource {
  /** The base's type name (SM_3AxisHead) */
  name: string;
  content: string;
  path?: string;
}

const declarationHead = (pouXml: string) =>
  (pouXml.match(/<POU\b[^>]*>\s*<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] ?? '').replace(/\(\*[\s\S]*?\*\)|\/\/[^\n]*|\{[^}\n]*\}/g, ' ');

/** The type the POU EXTENDS (its last name part: Lib.FB_X -> FB_X), or null */
export function extendsOf(pouXml: string): string | null {
  return declarationHead(stripInherited(pouXml)).match(/\bEXTENDS\s+([A-Za-z_][\w.]*)/i)?.[1]?.split('.').pop() ?? null;
}

/** The POU's name (its <POU Name="...">) */
export function pouNameOf(pouXml: string): string {
  return pouXml.match(/<POU\b[^>]*\bName=["']([^"']+)["']/i)?.[1] ?? '';
}

/** The POU's own methods' names (not the merged ones) */
export function ownMethodNames(pouXml: string): string[] {
  return [...stripInherited(pouXml).matchAll(/<Method\b[^>]*\bName=["']([^"']+)["']/gi)].map((m) => m[1]);
}

/** Has the POU (itself, not a base) this method? */
export function hasOwnMethod(pouXml: string, name: string): boolean {
  return ownMethodNames(pouXml).some((n) => n.toLowerCase() === name.toLowerCase());
}

/** Bases merged into the text (nearest first); empty when none */
export function inheritedBases(pouXml: string): string[] {
  const m = pouXml.match(/<!--kss-inherited\s+([^>]*?)\s*-->/);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** The merged block (to tell whether a merged method was changed); '' when none */
export function inheritedBlock(pouXml: string): string {
  return pouXml.match(BLOCK)?.[0] ?? '';
}

/** The POU's own text: the merged bases' methods taken out */
export function stripInherited(pouXml: string): string {
  return pouXml.includes(START) ? pouXml.replace(BLOCK, '') : pouXml;
}

/**
 * The bases' methods added to the POU (bases: nearest first, each a .TcPOU's text). The POU's own methods and those
 * of nearer bases win; an overridden one is kept as "<Base>.<name>" for SUPER^.
 */
export function mergeInherited(pouXml: string, bases: InheritedSource[]): string {
  const own = stripInherited(pouXml);
  const close = own.search(/<\/POU>/i);
  if (close < 0 || !bases.length) return own;
  const eol = own.includes('\r\n') ? '\r\n' : '\n';
  const defined = new Set(ownMethodNames(own).map((n) => n.toLowerCase()));
  const added: string[] = [];
  for (const base of bases) {
    const text = stripInherited(base.content);
    for (const m of text.matchAll(/([ \t]*)<Method\b([^>]*)>([\s\S]*?)<\/Method>/gi)) {
      const name = m[2].match(/\bName=["']([^"']+)["']/i)?.[1];
      if (!name) continue;
      const overridden = defined.has(name.toLowerCase());
      defined.add(name.toLowerCase());
      const attrs = m[2].replace(/\bName=["'][^"']+["']/i, `Name="${overridden ? `${base.name}.${name}` : name}"`);
      added.push(`${m[1]}<Method${attrs} KvalInheritedFrom="${base.name}">${m[3]}</Method>`);
    }
  }
  if (!added.length) return own;
  const indent = own.slice(0, close).match(/[ \t]*$/)?.[0] ?? '';
  const block = `${START} ${bases.map((b) => b.name).join(',')}-->${eol}${added.join(eol)}${eol}${END}${eol}${indent}`;
  return own.slice(0, close) + block + own.slice(close);
}

// ---- The bases found for the loaded POU (by its name): what reads its state machine merges them in ----

const registry = new Map<string, InheritedSource[]>();
let cache: { pou: string; out: string }[] = [];

/** The bases of a POU (nearest first; null or [] forgets them) */
export function setInheritedBases(pouName: string, bases: InheritedSource[] | null) {
  if (!pouName) return;
  if (bases?.length) registry.set(pouName.toLowerCase(), bases);
  else registry.delete(pouName.toLowerCase());
  cache = [];
}

/** The bases registered for that POU, nearest first */
export function registeredBases(pouName: string): InheritedSource[] {
  return registry.get(pouName.toLowerCase()) ?? [];
}

/** The POU's text with its registered bases' methods merged in (the text itself when it has none) */
export function withInherited(pouXml: string): string {
  if (!registry.size || !pouXml || pouXml.includes(START)) return pouXml;
  const bases = registry.get(pouNameOf(pouXml).toLowerCase());
  if (!bases) return pouXml;
  const hit = cache.find((c) => c.pou === pouXml);
  if (hit) return hit.out;
  const out = mergeInherited(pouXml, bases);
  cache = [{ pou: pouXml, out }, ...cache].slice(0, 6);
  return out;
}

/** The merged methods inherited from a base: their name as merged (lower case) -> the base */
export function inheritedMethodsOf(pouXml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of pouXml.matchAll(/<Method\b[^>]*\bName=["']([^"']+)["'][^>]*\bKvalInheritedFrom=["']([^"']+)["']/gi)) out.set(m[1].toLowerCase(), m[2]);
  return out;
}

/** "SM_3AxisHead.headIdle" (an overridden base method, as merged) -> "headIdle" */
export const plainMethodName = (name: string) => name.split('.').pop() ?? name;

interface MethodInfo {
  name: string;
  st: string;
  /** The base it comes from (null: the POU's own) */
  from: string | null;
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function methodsOf(pouXml: string): Map<string, MethodInfo> {
  const out = new Map<string, MethodInfo>();
  for (const m of pouXml.matchAll(/<Method\b([^>]*)>([\s\S]*?)<\/Method>/gi)) {
    const name = m[1].match(/\bName=["']([^"']+)["']/i)?.[1];
    const st = m[2].match(/<ST[^>]*>([\s\S]*?)<\/ST>/i)?.[1];
    if (!name || st === undefined) continue;
    const cdata = st.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    const key = name.toLowerCase();
    if (!out.has(key)) out.set(key, { name, st: cdata ? cdata[1] : decodeXml(st), from: m[1].match(/\bKvalInheritedFrom=["']([^"']+)["']/i)?.[1] ?? null });
  }
  return out;
}

const stripComments = (s: string) => s.replace(/\(\*[\s\S]*?\*\)/g, '').replace(/\/\/[^\r\n]*/g, '');

/** "[LABEL:] [SUPER^.|THIS^.]name(...);" alone on its line (a comment after it allowed) */
const CALL_LINE = /^(?:((?:[A-Za-z_][\w.]*\s*,\s*)*[A-Za-z_][\w.]*)\s*:(?!=)\s*)?(SUPER\^\.|THIS\^\.)?([A-Za-z_]\w*)\s*\(([^;]*)\)\s*;\s*(?:\/\/.*|\(\*.*?\*\))?$/i;

/**
 * The method's code with its calls of methods that set the state variable written out (see above). Unchanged when
 * there are none. method: the name of the method st is (its owner: the POU, or the base it is inherited from).
 */
export function expandStateCalls(pouXml: string, st: string, stateVar: string, method: string): string {
  if (!st || !stateVar) return st;
  const methods = methodsOf(pouXml);
  const self = pouNameOf(pouXml);
  const owners = [self, ...inheritedBases(pouXml)];
  const ownerOf = (m: MethodInfo) => m.from ?? self;
  const assigns = new RegExp(`\\b${stateVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:=`, 'i');

  const resolve = (name: string, viaSuper: boolean, owner: string): MethodInfo | null => {
    if (!viaSuper) return methods.get(name.toLowerCase()) ?? null;
    for (const base of owners.slice(owners.indexOf(owner) + 1)) {
      const renamed = methods.get(`${base}.${name}`.toLowerCase());
      if (renamed) return renamed;
      const plain = methods.get(name.toLowerCase());
      if (plain && plain.from === base) return plain;
    }
    return null;
  };
  const callsOf = (code: string) =>
    stripComments(code)
      .split(/\r?\n/)
      .map((l) => l.trim().match(CALL_LINE))
      .filter((m): m is RegExpMatchArray => !!m);

  // (does it, or a method it calls, set the state variable?)
  const memo = new Map<MethodInfo, boolean>();
  const setsState = (m: MethodInfo, seen: Set<MethodInfo>): boolean => {
    if (memo.has(m)) return memo.get(m)!;
    if (seen.has(m)) return false;
    seen.add(m);
    const code = stripComments(m.st);
    const r =
      assigns.test(code) ||
      callsOf(m.st).some((c) => {
        const t = resolve(c[3], /^SUPER/i.test(c[2] ?? ''), ownerOf(m));
        return !!t && setsState(t, seen);
      });
    memo.set(m, r);
    return r;
  };

  let changed = false;
  const expand = (code: string, owner: string, stack: MethodInfo[]): string[] => {
    const out: string[] = [];
    let inComment = false;
    for (const raw of code.split(/\r?\n/)) {
      const line = raw.trim();
      // (a call inside a (* ... *) comment stays one)
      const opens = (line.match(/\(\*/g) ?? []).length;
      const closes = (line.match(/\*\)/g) ?? []).length;
      const wasIn = inComment;
      if (opens !== closes) inComment = opens > closes;
      const call = !wasIn ? line.match(CALL_LINE) : null;
      const target = call ? resolve(call[3], /^SUPER/i.test(call[2] ?? ''), owner) : null;
      if (!call || !target || stack.includes(target) || stack.length >= 6 || !setsState(target, new Set())) {
        out.push(raw);
        continue;
      }
      changed = true;
      if (call[1]) out.push(`${call[1]}:`);
      out.push(`{kss-in ${target.name} ${ownerOf(target)}}`);
      out.push(...expand(target.st, ownerOf(target), [...stack, target]));
      out.push('{kss-out}');
    }
    return out;
  };
  const start = methods.get(method.toLowerCase());
  const lines = expand(st, start ? ownerOf(start) : self, start ? [start] : []);
  return changed ? lines.join('\n') : st;
}

/** "{kss-in <method> <owner>}" / "{kss-out}": where the lines after it are written (see expandStateCalls) */
export function inlineMarker(line: string): { method: string; owner: string } | 'out' | null {
  const t = line.trim();
  if (t === '{kss-out}') return 'out';
  const m = t.match(/^\{kss-in\s+(\S+)\s+(\S+)\}$/);
  return m ? { method: m[1], owner: m[2] } : null;
}

/** Inlined code as shown to the user: "{kss-in headIdle SM_3AxisHead}" as a comment naming the method, "{kss-out}" left out */
export function readableInline(code: string): string {
  if (!code.includes('{kss-')) return code;
  return code
    .split('\n')
    .flatMap((line) => {
      const m = inlineMarker(line);
      if (m === 'out') return [];
      return m ? [`// ${plainMethodName(m.method)}() (${m.owner})`] : [line];
    })
    .join('\n');
}

/** A .TcPOU's methods by name (lower case): each one's whole <Method>…</Method> text */
function methodBlocks(pouXml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of stripInherited(pouXml).matchAll(/<Method\b[^>]*\bName=["']([^"']+)["'][^>]*>[\s\S]*?<\/Method>/gi)) {
    if (!out.has(m[1].toLowerCase())) out.set(m[1].toLowerCase(), m[0]);
  }
  return out;
}

/**
 * A base changed on disk (theirs) while its methods were edited here (mine; both from saved): merged by method. A
 * method changed only here keeps its edit, one changed only on disk takes the disk's, one changed in both keeps the
 * edit here (a conflict: Save writes it over the disk's). { text, kept, conflicts } (method names)
 */
export function mergeBaseEdits(saved: string, mine: string, theirs: string): { text: string; kept: string[]; conflicts: string[] } {
  const s = methodBlocks(saved);
  const m = methodBlocks(mine);
  const t = methodBlocks(theirs);
  let text = theirs;
  const kept: string[] = [];
  const conflicts: string[] = [];
  for (const [name, block] of m) {
    const before = s.get(name);
    if (before === undefined || block === before) continue;
    const disk = t.get(name);
    if (disk === undefined) continue;
    const display = block.match(/\bName=["']([^"']+)["']/)?.[1] ?? name;
    if (disk !== before) conflicts.push(display);
    else kept.push(display);
    text = text.split(disk).join(block);
  }
  return { text, kept, conflicts };
}
