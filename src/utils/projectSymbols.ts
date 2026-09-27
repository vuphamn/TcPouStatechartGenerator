/**
 * The PLC project's types, for completion, Go to Definition and the checks: POUs (their inputs, outputs, methods,
 * properties and base class), GVLs, structs, enums and interfaces, read from the project's files (XAE and the
 * desktop app send them; the web edition has the loaded POU and enum only). The loaded POU and enum count as the
 * app has them (edited or not).
 */
import { extractPouDeclaration } from './stSymbolDefinition.ts';
import { getMethodCodeFromPou } from './pouStateEditor.ts';
import { enumMembers } from './stateMachineLint.ts';
import { COMMON_TYPES, PouVariable, declarationVariables } from './pouVariables.ts';
import { STANDARD_FBS } from './stdSignatures.ts';

/** A project file as the hosts send it (implementations left out) */
export interface ProjectFile {
  name: string;
  path?: string;
  content: string;
}

export type TypeKind = 'FUNCTION_BLOCK' | 'PROGRAM' | 'FUNCTION' | 'INTERFACE' | 'STRUCT' | 'UNION' | 'ENUM' | 'ALIAS' | 'GVL';

export interface ProjectType {
  name: string;
  kind: TypeKind;
  extends?: string;
  /** Members as PouVariable: scope VAR_INPUT / VAR_OUTPUT / VAR / METHOD / PROPERTY / ENUM (a value) / ... */
  members: PouVariable[];
  /** A GVL / an enum with {attribute 'qualified_only'}: its names only as GVL.x / E_X.y */
  qualifiedOnly?: boolean;
  path?: string;
}

export interface ProjectSymbols {
  project?: string;
  types: Map<string, ProjectType>;
}

const XML_DECL = /<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Declaration>/i;

/** Methods and properties of a POU / interface (public ones: PRIVATE / PROTECTED left out) */
function callables(xml: string): PouVariable[] {
  const out: PouVariable[] = [];
  const rx = /<(Method|Property)\b[^>]*\bName="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(xml))) {
    const decl = m[3].match(XML_DECL)?.[1] ?? '';
    const head = decl.split(/\r?\n/).find((l) => /^\s*(METHOD|PROPERTY)\b/i.test(l)) ?? '';
    if (/\b(PRIVATE|PROTECTED)\b/i.test(head)) continue;
    const type = head.match(/:\s*([^;\/(]+)/)?.[1]?.trim() ?? '';
    const params = declarationVariables(decl).filter((p) => /^VAR_(INPUT|OUTPUT|IN_OUT)$/.test(p.scope));
    out.push({ name: m[2], type, scope: m[1].toUpperCase() === 'METHOD' ? 'METHOD' : 'PROPERTY', text: head.trim(), params });
  }
  return out;
}

/** One file's type (null: not a type file) */
export function parseProjectFile(file: ProjectFile): ProjectType | null {
  const c = file.content || '';
  const ext = (file.name.match(/\.(\w+)$/)?.[1] ?? '').toLowerCase();
  const nameOf = (tag: string) => c.match(new RegExp(`<${tag}\\b[^>]*\\bName="([^"]+)"`, 'i'))?.[1] ?? file.name.replace(/\.\w+$/, '');
  if (ext === 'tcpou') {
    const decl = extractPouDeclaration(c);
    const head = decl.match(/^\s*(FUNCTION_BLOCK|PROGRAM|FUNCTION)\b([^\n]*)/im);
    const kind = (head?.[1]?.toUpperCase() ?? 'FUNCTION_BLOCK') as TypeKind;
    const ext2 = head?.[2]?.match(/\bEXTENDS\s+([\w.]+)/i)?.[1];
    return { name: nameOf('POU'), kind, extends: ext2?.split('.').pop(), members: [...declarationVariables(decl), ...callables(c)], path: file.path };
  }
  if (ext === 'tcio') {
    const decl = c.match(XML_DECL)?.[1] ?? '';
    const base = decl.match(/\bINTERFACE\s+\w+\s+EXTENDS\s+([\w.]+)/i)?.[1];
    return { name: nameOf('Itf'), kind: 'INTERFACE', extends: base?.split('.').pop(), members: callables(c), path: file.path };
  }
  if (ext === 'tcgvl') {
    const decl = c.match(XML_DECL)?.[1] ?? '';
    return { name: nameOf('GVL'), kind: 'GVL', members: declarationVariables(decl, 'GVL'), qualifiedOnly: /\{\s*attribute\s+'qualified_only'\s*\}/i.test(decl), path: file.path };
  }
  if (ext === 'tcdut') {
    const decl = c.match(XML_DECL)?.[1] ?? c;
    const name = nameOf('DUT');
    if (/\bSTRUCT\b/i.test(decl)) return { name, kind: 'STRUCT', extends: decl.match(/\bSTRUCT\s+EXTENDS\s+([\w.]+)/i)?.[1] ?? decl.match(/\bEXTENDS\s+([\w.]+)\s*:/i)?.[1], members: declarationVariables(decl), path: file.path };
    if (/\bUNION\b/i.test(decl)) return { name, kind: 'UNION', members: declarationVariables(decl), path: file.path };
    const values = enumMembers(c);
    if (values.length) return { name, kind: 'ENUM', members: values.map((v) => ({ name: v, type: name, scope: 'ENUM' })), qualifiedOnly: /\{\s*attribute\s+'qualified_only'\s*\}/i.test(decl), path: file.path };
    return { name, kind: 'ALIAS', members: [], path: file.path };
  }
  return null;
}

/** The project's types; the loaded POU / enum (as in the app) replace their files */
export function buildProjectSymbols(files: ProjectFile[], loaded: ProjectFile[] = [], project?: string): ProjectSymbols {
  const types = new Map<string, ProjectType>();
  for (const f of [...files, ...loaded]) {
    const t = parseProjectFile(f);
    if (t) types.set(t.name.toLowerCase(), t);
  }
  return { project, types };
}

// ---------------------------------------------------------------------------------------------------------------
// The shared project (the app sets it when it has one)

let current: ProjectSymbols | null = null;
let fromProject = false;
const listeners = new Set<() => void>();

/** fromHost: read from the PLC project (XAE, desktop); else the loaded files only */
export function setProjectSymbols(s: ProjectSymbols | null, fromHost = false): void {
  current = s;
  fromProject = fromHost && !!s;
  listeners.forEach((l) => l());
}
export const getProjectSymbols = () => current;
/** Whether the types come from the PLC project (not only the loaded files) */
export const hasProjectSymbols = () => fromProject;
export function onProjectSymbols(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------------------------------------------
// Completion and resolution

/** The base type of a declared type: ARRAY [..] OF / POINTER TO / REFERENCE TO taken off, a namespace too */
export function baseTypeName(type: string): string {
  let t = (type || '').trim();
  for (let i = 0; i < 4; i++) t = t.replace(/^ARRAY\s*\[[^\]]*\]\s*OF\s+/i, '').replace(/^(?:POINTER|REFERENCE)\s+TO\s+/i, '');
  return (t.match(/^([A-Za-z_][\w.]*)/)?.[1] ?? '').split('.').pop() ?? '';
}

/** What a scope offers: the names it resolves, and the members of a chain (a.b.) */
export interface SymbolScope {
  /** Names usable as they are: the POU's (and its base's) variables, doState()'s, the GVLs' (unqualified), GVL / enum / PROGRAM names */
  top: PouVariable[];
  /** Members after "a.b." (null: the chain does not resolve) */
  members(chain: string[]): PouVariable[] | null;
  /** The type of a chain's last part ("smAxis" -> SM_KAxis) */
  typeOf(chain: string[]): ProjectType | null;
  /** Names that are no variables to declare (states, types, enum values, ...) */
  knownNames: string[];
  /** Types for a new variable */
  types: string[];
  /** The POU's base class is known (its inherited names are in top): the undeclared check is reliable */
  complete: boolean;
  /** Everything by category, for the Input Assistant (F2) */
  catalog(): { category: string; items: PouVariable[] }[];
  /** What a call takes (fbTimer(, smAxis.home(, stop(): its inputs, in-outs and outputs (parameter hints) */
  signature(chain: string[]): { label: string; returns?: string; params: PouVariable[] } | null;
}

/** Members an instance of a type offers from outside (a FB's inputs, outputs, methods, properties; inherited too) */
function outerMembers(t: ProjectType, symbols: ProjectSymbols, depth = 0): PouVariable[] {
  if (depth > 8) return [];
  const own = t.members.filter((m) => {
    if (t.kind === 'FUNCTION_BLOCK') return /^(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|METHOD|PROPERTY)$/.test(m.scope);
    if (t.kind === 'PROGRAM') return /^(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR|METHOD|PROPERTY)$/.test(m.scope);
    return true;
  });
  const base = t.extends ? symbols.types.get(t.extends.toLowerCase()) : undefined;
  const inherited = base ? outerMembers(base, symbols, depth + 1).filter((b) => !own.some((o) => o.name.toLowerCase() === b.name.toLowerCase())) : [];
  return [...own, ...inherited];
}

/** Every member of a type, as its own code sees it (a FB's VAR too; inherited) */
function innerMembers(t: ProjectType, symbols: ProjectSymbols, depth = 0): PouVariable[] {
  if (depth > 8) return [];
  const base = t.extends ? symbols.types.get(t.extends.toLowerCase()) : undefined;
  const inherited = base ? innerMembers(base, symbols, depth + 1) : [];
  return [...t.members, ...inherited.filter((b) => !t.members.some((o) => o.name.toLowerCase() === b.name.toLowerCase()))];
}

const STANDARD_NAMES = ['TON', 'TOF', 'TP', 'R_TRIG', 'F_TRIG', 'CTU', 'CTD', 'CTUD', 'RS', 'SR', ...COMMON_TYPES];

/**
 * The scope of code in a method of the loaded POU (doState() by default): its own variables, the POU's and its
 * base's, the project's GVLs, and the types to go into
 */
export function symbolScope(pouXml: string, symbols: ProjectSymbols | null, opts: { method?: string; states?: string[] } = {}): SymbolScope {
  const s: ProjectSymbols = symbols ?? { types: new Map() };
  const methodName = opts.method ?? 'doState';
  const method = pouXml ? getMethodCodeFromPou(pouXml, methodName) : null;
  const own = method?.methodFound ? declarationVariables(method.declaration || '', methodName) : [];
  const decl = pouXml ? extractPouDeclaration(pouXml) : '';
  const pouName = decl.match(/^\s*(?:FUNCTION_BLOCK|PROGRAM|FUNCTION)\s+(?:(?:PUBLIC|INTERNAL|ABSTRACT|FINAL)\s+)*(\w+)/im)?.[1];
  const baseName = decl.match(/\bEXTENDS\s+([\w.]+)/i)?.[1]?.split('.').pop();
  const self: ProjectType = { name: pouName ?? 'POU', kind: 'FUNCTION_BLOCK', extends: baseName, members: [...declarationVariables(decl), ...(pouXml ? callables(pouXml) : [])] };
  const base = baseName ? s.types.get(baseName.toLowerCase()) : undefined;
  const pouMembers = innerMembers(self, s);
  const top: PouVariable[] = [];
  const seen = new Set<string>();
  const add = (v: PouVariable) => {
    const k = v.name.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    top.push(v);
  };
  own.forEach(add);
  pouMembers.forEach((m) => add(base && !self.members.includes(m) ? { ...m, scope: `${m.scope} (${base.name})` } : m));
  for (const t of s.types.values()) {
    if (t.kind === 'GVL') {
      add({ name: t.name, type: 'GVL', scope: 'GVL' });
      if (!t.qualifiedOnly) t.members.forEach((m) => add({ ...m, scope: t.name }));
    } else if (t.kind === 'PROGRAM') add({ name: t.name, type: 'PROGRAM', scope: 'PROGRAM' });
    else if (t.kind === 'ENUM') add({ name: t.name, type: 'enum', scope: 'ENUM' });
  }
  const typeNamed = (name: string): ProjectType | null => {
    const hit = s.types.get(name.toLowerCase());
    if (hit) return hit;
    const std = STANDARD_FBS[name.toUpperCase()];
    return std ? { name: name.toUpperCase(), kind: 'FUNCTION_BLOCK', members: std } : null;
  };
  const lookupChain = (chain: string[]): { type: ProjectType | null; member?: PouVariable } => {
    if (!chain.length) return { type: null };
    const first = chain[0].replace(/\[.*$/, '').replace(/\^$/, '');
    const k = first.toLowerCase();
    let type: ProjectType | null = null;
    const v = top.find((t) => t.name.toLowerCase() === k);
    if (v && /^(GVL|PROGRAM|ENUM)$/.test(v.scope)) type = s.types.get(k) ?? null;
    else if (v) type = typeNamed(baseTypeName(v.type));
    else type = s.types.get(k) ?? null;
    let member: PouVariable | undefined = v;
    for (const part of chain.slice(1)) {
      if (!type) return { type: null };
      const p = part.replace(/\[.*$/, '').replace(/\^$/, '').toLowerCase();
      member = (type.kind === 'GVL' || type.kind === 'ENUM' || type.kind === 'STRUCT' || type.kind === 'UNION' ? innerMembers(type, s) : outerMembers(type, s)).find((m) => m.name.toLowerCase() === p);
      if (!member) return { type: null };
      type = typeNamed(baseTypeName(member.type));
    }
    return { type, member };
  };
  const members = (chain: string[]) => {
    const { type } = lookupChain(chain);
    if (!type) return null;
    return type.kind === 'GVL' || type.kind === 'ENUM' || type.kind === 'STRUCT' || type.kind === 'UNION' ? innerMembers(type, s) : outerMembers(type, s);
  };
  const typeNames = [...s.types.values()].filter((t) => t.kind !== 'GVL' && t.kind !== 'PROGRAM').map((t) => t.name);
  const enumValues = [...s.types.values()].filter((t) => t.kind === 'ENUM' && !t.qualifiedOnly).flatMap((t) => t.members.map((m) => m.name));
  const catalog = () => {
    const gvlNames = new Set([...s.types.values()].filter((t) => t.kind === 'GVL').map((t) => t.name));
    const byCat = new Map<string, PouVariable[]>();
    const put = (c: string, v: PouVariable) => (byCat.get(c) ?? byCat.set(c, []).get(c)!).push(v);
    for (const v of top) {
      if (v.scope === 'GVL' || gvlNames.has(v.scope)) put('Global variables', v);
      else if (v.scope === 'PROGRAM') put('Programs', v);
      else if (v.scope === 'ENUM') continue;
      else if (/\(.*\)$/.test(v.scope)) put('Inherited', v);
      else put('Variables', v);
    }
    for (const t of s.types.values()) {
      if (t.kind === 'GVL') {
        if (t.qualifiedOnly) t.members.forEach((m) => put('Global variables', { ...m, name: `${t.name}.${m.name}`, scope: t.name }));
        continue;
      }
      if (t.kind !== 'PROGRAM') put('Types', { name: t.name, type: t.kind.toLowerCase().replace('_', ' '), scope: 'type' });
      if (t.kind === 'ENUM') t.members.forEach((m) => put('Enum values', { name: `${t.name}.${m.name}`, type: t.name, scope: 'enum value' }));
    }
    (opts.states ?? []).forEach((st) => put('States', { name: st, type: 'state', scope: 'state' }));
    STANDARD_NAMES.forEach((n) => put('Standard', { name: n, type: COMMON_TYPES.includes(n) && !/^(TON|R_TRIG)$/.test(n) ? 'type' : 'function block', scope: 'standard' }));
    const order = ['Variables', 'Inherited', 'Global variables', 'Programs', 'States', 'Enum values', 'Types', 'Standard'];
    return order.filter((c) => byCat.has(c)).map((c) => ({ category: c, items: [...new Map(byCat.get(c)!.map((v) => [v.name.toLowerCase(), v])).values()] }));
  };
  const signature = (chain: string[]) => {
    if (!chain.length) return null;
    const name = chain[chain.length - 1].replace(/\[.*$/, '');
    const io = (list: PouVariable[]) => list.filter((m) => /^VAR_(INPUT|OUTPUT|IN_OUT)$/.test(m.scope));
    // A method of what is before the dot, or an FB instance there
    let member: PouVariable | undefined;
    if (chain.length > 1) {
      const owner = lookupChain(chain.slice(0, -1)).type;
      if (!owner) return null;
      member = (owner.kind === 'GVL' || owner.kind === 'STRUCT' ? innerMembers(owner, s) : outerMembers(owner, s)).find((m) => m.name.toLowerCase() === name.toLowerCase());
    } else member = top.find((m) => m.name.toLowerCase() === name.toLowerCase());
    const label = chain.join('.');
    if (member?.scope.startsWith('METHOD')) return { label, returns: member.type || undefined, params: member.params ?? [] };
    if (member) {
      const t = typeNamed(baseTypeName(member.type));
      if (t && t.kind === 'FUNCTION_BLOCK') return { label, params: io(outerMembers(t, s)) };
      return null;
    }
    // A function of the project
    const fn = s.types.get(name.toLowerCase());
    if (fn?.kind === 'FUNCTION') return { label, params: io(fn.members) };
    return null;
  };
  return {
    signature,
    catalog,
    top,
    members,
    typeOf: (chain) => lookupChain(chain).type,
    knownNames: [...(opts.states ?? []), ...typeNames, ...enumValues, ...STANDARD_NAMES, ...[...s.types.values()].filter((t) => t.kind === 'FUNCTION').map((t) => t.name)],
    types: [...new Set([...COMMON_TYPES, ...typeNames])],
    complete: !baseName || !!base,
  };
}

/** The identifier at a caret and the chain before it ("smAxis.cmd_b|" -> word cmd_b, chain [smAxis]) */
export function completionAt(text: string, caret: number): { start: number; end: number; word: string; chain: string[] | null } {
  let start = caret;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  let end = caret;
  while (end < text.length && /\w/.test(text[end])) end++;
  const word = text.slice(start, end);
  if (start === 0 || text[start - 1] !== '.') return { start, end, word, chain: null };
  // Back over "a.b[1]^." to the chain's start
  const before = text.slice(0, start - 1);
  const m = before.match(/((?:[A-Za-z_]\w*(?:\[[^\]]*\])?\^?\s*\.\s*)*[A-Za-z_]\w*(?:\[[^\]]*\])?\^?)\s*$/);
  if (!m) return { start, end, word, chain: [] };
  const chain = m[1].split('.').map((p) => p.trim()).filter(Boolean);
  // (THIS^.x: the POU's own)
  if (chain.length && /^THIS\^?$/i.test(chain[0])) chain.shift();
  return { start, end, word, chain };
}
