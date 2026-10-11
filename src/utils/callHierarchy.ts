/**
 * The Call Hierarchy and Go to Implementation of the app's code editors (as XAE's Call Tree, VS Code's Call Hierarchy):
 * from POU files (the loaded one and the project's others that name what is looked for, read in full), who calls a
 * method, an action or a POU's body, what it calls, and the implementations of an interface (its methods) or a
 * method's overrides. By name, as the rest of the editors: instances' types (fbAxis : FB_Axis), THIS^ / SUPER^, an
 * inherited method, an interface's variable (itfAxis.Move(): each implementation's Move).
 */

export interface PouUnit {
  /** '' : the POU's body; else a method's / action's name; a property's accessor: Name.Get / Name.Set */
  member: string;
  kind: 'body' | 'method' | 'action' | 'property';
  decl: string;
  impl: string;
}
export interface ParsedPou {
  name: string;
  kind: 'FUNCTION_BLOCK' | 'PROGRAM' | 'FUNCTION' | 'INTERFACE';
  extends: string | null;
  implements: string[];
  decl: string;
  units: PouUnit[];
  path?: string;
}
export interface CallSite {
  /** 1-based, in the unit's implementation */
  line: number;
  text: string;
}
export interface CallNode {
  pou: string;
  member: string;
  kind: PouUnit['kind'];
  sites: CallSite[];
  path?: string;
}

const lower = (s: string) => s.toLowerCase();
const last = (s: string) => s.split('.').pop() ?? s;
const cdata = (s: string | undefined) => s ?? '';
const listOf = (s: string | undefined) => (s ?? '').split(',').map((x) => last(x.trim())).filter((x) => /^[A-Za-z_]\w*$/.test(x));

/** A POU file's units (an interface: its methods' declarations) */
export function parsePou(xml: string, path?: string): ParsedPou | null {
  const head = /<(POU|Itf)\b[^>]*\bName="([^"]+)"/i.exec(xml);
  if (!head) return null;
  // (the members apart: what is left is the POU's own declaration and body)
  const members: PouUnit[] = [];
  const own = xml.replace(/<(Method|Action|Property)\b[^>]*\bName="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi, (_m, tag: string, name: string, inner: string) => {
    const decl = cdata(/<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Declaration>/i.exec(inner)?.[1]);
    if (/^Property$/i.test(tag)) {
      for (const acc of inner.matchAll(/<(Get|Set)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
        members.push({ member: `${name}.${acc[1][0].toUpperCase()}${acc[1].slice(1).toLowerCase()}`, kind: 'property', decl: cdata(/<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(acc[2])?.[1]), impl: cdata(/<ST>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/ST>/i.exec(acc[2])?.[1]) });
      }
      return '';
    }
    members.push({ member: name, kind: /^Action$/i.test(tag) ? 'action' : 'method', decl, impl: cdata(/<ST>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/ST>/i.exec(inner)?.[1]) });
    return '';
  });
  const decl = cdata(/<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Declaration>/i.exec(own)?.[1]);
  const body = cdata(/<ST>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/ST>/i.exec(own)?.[1]);
  const kindM = /^\s*(FUNCTION_BLOCK|PROGRAM|FUNCTION|INTERFACE)\b([^\n]*(?:\n(?!\s*(?:VAR|END_|STRUCT|\{))[^\n]*)*)/im.exec(blank(decl));
  const kind = (kindM?.[1]?.toUpperCase() ?? (/^Itf$/i.test(head[1]) ? 'INTERFACE' : 'FUNCTION_BLOCK')) as ParsedPou['kind'];
  const rest = kindM?.[2] ?? '';
  const ext = /\bEXTENDS\b([\s\S]*?)(?=\bIMPLEMENTS\b|$)/i.exec(rest)?.[1];
  const imp = /\bIMPLEMENTS\b([\s\S]*)$/i.exec(rest)?.[1];
  const exts = listOf(ext);
  return {
    name: head[2],
    kind,
    // (an interface may extend several: the first kept as its base, all as its implements)
    extends: kind === 'INTERFACE' ? null : exts[0] ?? null,
    implements: kind === 'INTERFACE' ? exts : listOf(imp),
    decl,
    units: [...(kind === 'INTERFACE' ? [] : [{ member: '', kind: 'body' as const, decl, impl: body }]), ...members],
    path,
  };
}

/** Code with its comments and strings blanked (lengths and line breaks kept) */
export function blank(code: string): string {
  return code.replace(/\(\*[\s\S]*?\*\)|\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\$.|[^'$\n])*'|"(?:\$.|[^"$\n])*"/g, (m) => m.replace(/[^\n]/g, ' '));
}

const KEYWORDS = new Set('IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT RETURN EXIT CONTINUE AND OR XOR NOT MOD AND_THEN OR_ELSE TRUE FALSE ADR SIZEOF REF __NEW __DELETE'.split(' '));

/** The calls in an implementation: { name, qualifier (THIS^, SUPER^, an instance), line, text } */
export function callsIn(impl: string): { name: string; qualifier: string | null; line: number; text: string }[] {
  const code = blank(impl);
  const lines = impl.split(/\r?\n/);
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const out: { name: string; qualifier: string | null; line: number; text: string }[] = [];
  const rx = /(?<![\w#.])(?:([A-Za-z_]\w*)(\^?)[ \t]*\.[ \t]*)?([A-Za-z_]\w*)[ \t]*\(/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(code))) {
    if (KEYWORDS.has(m[3].toUpperCase())) continue;
    if (m[1] && KEYWORDS.has(m[1].toUpperCase())) continue;
    const ln = lineAt(m.index + m[0].lastIndexOf(m[3]));
    out.push({ name: m[3], qualifier: m[1] ? `${m[1]}${m[2]}` : null, line: ln + 1, text: (lines[ln] ?? '').trim() });
  }
  return out;
}

/** The variables a declaration types (fbAxis : FB_Axis; itf : I_Axis; ref : REFERENCE TO FB_X) → name lower → type */
export function instancesIn(...decls: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const rx = /^[ \t]*([A-Za-z_]\w*(?:[ \t]*,[ \t]*[A-Za-z_]\w*)*)[ \t]*(?:AT[ \t]+%[\w.*]+[ \t]*)?:(?!=)[ \t]*(?:REFERENCE[ \t]+TO[ \t]+|POINTER[ \t]+TO[ \t]+)?([A-Za-z_][\w.]*)/gim;
  for (const d of decls) {
    const code = blank(d);
    let m: RegExpExecArray | null;
    rx.lastIndex = 0;
    while ((m = rx.exec(code))) for (const n of m[1].split(',')) out.set(lower(n.trim()), last(m[2]));
  }
  return out;
}

/** A set of parsed POUs, by name */
export class PouIndex {
  readonly pous = new Map<string, ParsedPou>();
  constructor(files: { content: string; path?: string }[] = []) {
    for (const f of files) this.add(f.content, f.path);
  }
  add(xml: string, path?: string): ParsedPou | null {
    const p = parsePou(xml, path);
    if (p) this.pous.set(lower(p.name), p);
    return p;
  }
  get(name: string | null | undefined): ParsedPou | undefined {
    return name ? this.pous.get(lower(last(name))) : undefined;
  }
  /** A POU and its bases (the ones known), nearest first */
  chain(name: string): ParsedPou[] {
    const out: ParsedPou[] = [];
    let p = this.get(name);
    while (p && !out.includes(p)) {
      out.push(p);
      p = this.get(p.extends);
    }
    return out;
  }
  /** Every interface a POU implements (its bases' too; the interfaces those extend, when known) */
  interfacesOf(name: string): Set<string> {
    const out = new Set<string>();
    const add = (i: string) => {
      if (out.has(lower(i))) return;
      out.add(lower(i));
      for (const x of this.get(i)?.implements ?? []) add(x);
    };
    for (const p of this.chain(name)) for (const i of p.implements) add(i);
    return out;
  }
  /** Does a type (a POU) stand for `name`: it is it, extends it, or implements it (an interface) */
  isA(type: string, name: string): boolean {
    const t = lower(last(type));
    const n = lower(last(name));
    if (t === n) return true;
    return this.chain(type).some((p) => lower(p.name) === n) || this.interfacesOf(type).has(n);
  }
  /** The unit a POU runs for a member called on it: its own or its nearest base's */
  unitOf(pou: string, member: string): { pou: ParsedPou; unit: PouUnit } | null {
    for (const p of this.chain(pou)) {
      const u = p.units.find((x) => lower(x.member) === lower(member) && x.kind !== 'property');
      if (u) return { pou: p, unit: u };
    }
    return null;
  }
}

const key = (pou: string, member: string) => `${lower(pou)}|${lower(member)}`;

/**
 * Who calls a POU's member ('' : its body): each caller (a POU's unit) with its call sites. A call counts when it
 * runs that member: unqualified or THIS^ in the POU (or one extending it that does not have its own), SUPER^ in one
 * extending it, inst.Member where inst's type is the POU, one extending it, or an interface it implements (whichever
 * the variable refers to at run time); its body: inst(...) of its type, a function's or a program's name
 */
export function incomingCalls(index: PouIndex, target: { pou: string; member: string }): CallNode[] {
  const t = index.get(target.pou);
  const tName = t?.name ?? target.pou;
  const m = lower(target.member);
  const ifaces = index.interfacesOf(tName);
  const groups = new Map<string, CallNode>();
  for (const p of index.pous.values()) {
    for (const u of p.units) {
      if (!u.impl) continue;
      const inst = instancesIn(p.decl, u.decl);
      for (const c of callsIn(u.impl)) {
        let hit = false;
        if (m) {
          if (lower(c.name) !== m) continue;
          const q = c.qualifier ? lower(c.qualifier) : null;
          if (!q || q === 'this^') {
            // (here: this POU, or one inheriting the member)
            hit = lower(p.name) === lower(tName) || (index.isA(p.name, tName) && index.unitOf(p.name, target.member)?.pou.name.toLowerCase() === lower(tName));
          } else if (q === 'super^') {
            hit = !!p.extends && index.unitOf(p.extends, target.member)?.pou.name.toLowerCase() === lower(tName);
          } else {
            const type = inst.get(q);
            if (type && ifaces.has(lower(type))) {
              // (an interface the target implements: any of its implementations runs)
              hit = true;
            } else if (type && index.isA(type, tName)) {
              // (the target or one extending it: the target's member runs unless it has its own)
              const ran = index.unitOf(type, target.member);
              hit = !ran || lower(ran.pou.name) === lower(tName);
            }
          }
        } else {
          if (c.qualifier) continue;
          const n = lower(c.name);
          hit = n === lower(tName) || lower(inst.get(n) ?? '') === lower(tName);
        }
        if (!hit) continue;
        const k = key(p.name, u.member);
        const g = groups.get(k) ?? { pou: p.name, member: u.member, kind: u.kind, sites: [], path: p.path };
        g.sites.push({ line: c.line, text: c.text });
        groups.set(k, g);
      }
    }
  }
  return [...groups.values()];
}

/**
 * What a POU's member calls: the members and bodies of the POUs known (its own and its bases', THIS^ / SUPER^, an
 * instance's type's, an interface's implementations'), and the functions / programs named in `typeKinds`
 */
export function outgoingCalls(index: PouIndex, from: { pou: string; member: string }, typeKinds: (name: string) => string | undefined = () => undefined): CallNode[] {
  const p = index.get(from.pou);
  const u = p?.units.find((x) => lower(x.member) === lower(from.member));
  if (!p || !u) return [];
  const inst = instancesIn(p.decl, u.decl);
  const groups = new Map<string, CallNode>();
  const add = (pou: string, member: string, kind: PouUnit['kind'], site: CallSite, path?: string) => {
    const k = key(pou, member);
    const g = groups.get(k) ?? { pou, member, kind, sites: [], path };
    g.sites.push(site);
    groups.set(k, g);
  };
  const implementers = (iface: string) => [...index.pous.values()].filter((x) => x.kind !== 'INTERFACE' && index.interfacesOf(x.name).has(lower(iface)));
  for (const c of callsIn(u.impl)) {
    const site = { line: c.line, text: c.text };
    const q = c.qualifier ? lower(c.qualifier) : null;
    if (!q || q === 'this^') {
      const own = index.unitOf(p.name, c.name);
      if (own) {
        add(own.pou.name, own.unit.member, own.unit.kind, site, own.pou.path);
        continue;
      }
      if (q) continue;
      const type = inst.get(lower(c.name));
      const tp = type ? index.get(type) : undefined;
      if (tp && tp.kind !== 'INTERFACE') {
        add(tp.name, '', 'body', site, tp.path);
        continue;
      }
      const named = index.get(c.name);
      const kind = named?.kind ?? typeKinds(c.name);
      if (kind === 'FUNCTION' || kind === 'PROGRAM') add(named?.name ?? c.name, '', 'body', site, named?.path);
      continue;
    }
    const type = q === 'super^' ? p.extends : inst.get(q);
    if (!type) continue;
    const tp = index.get(type);
    if (tp?.kind === 'INTERFACE' || (!tp && typeKinds(type) === 'INTERFACE')) {
      // (through an interface: each implementation's member)
      const impls = implementers(type);
      for (const x of impls) {
        const at = index.unitOf(x.name, c.name);
        if (at) add(at.pou.name, at.unit.member, at.unit.kind, site, at.pou.path);
      }
      if (!impls.length) add(tp?.name ?? type, c.name, 'method', site, tp?.path);
      continue;
    }
    const at = index.unitOf(type, c.name);
    if (at) add(at.pou.name, at.unit.member, at.unit.kind, site, at.pou.path);
    // (a type not at hand: a function block's method (the project's, a library's) said by name; a struct's field not)
    else if (!tp && typeKinds(type) === 'FUNCTION_BLOCK') add(type, c.name, 'method', site);
  }
  return [...groups.values()];
}

/**
 * Go to Implementation: an interface's implementations (POUs implementing it, or extending one that does); with a
 * member, their methods of that name; a POU's member: its overrides in the POUs extending it
 */
export function implementationsOf(index: PouIndex, type: string, member?: string): CallNode[] {
  const t = index.get(type);
  const isIface = t?.kind === 'INTERFACE' || (!t && /^I_/i.test(last(type)));
  const out: CallNode[] = [];
  for (const p of index.pous.values()) {
    if (p.kind === 'INTERFACE' || lower(p.name) === lower(last(type))) continue;
    const stands = isIface ? index.interfacesOf(p.name).has(lower(last(type))) : index.chain(p.name).some((x) => lower(x.name) === lower(last(type)));
    if (!stands) continue;
    if (!member) {
      out.push({ pou: p.name, member: '', kind: 'body', sites: [], path: p.path });
      continue;
    }
    // (its own member only: an inherited one is the base's, listed once)
    const u = p.units.find((x) => lower(x.member) === lower(member) && x.kind !== 'property');
    if (u) out.push({ pou: p.name, member: u.member, kind: u.kind, sites: [], path: p.path });
  }
  return out.sort((a, b) => a.pou.localeCompare(b.pou, undefined, { sensitivity: 'base' }));
}

/** A node's label: FB_Axis.Move(), FB_Axis (body), MAIN */
export const nodeLabel = (n: { pou: string; member: string; kind?: PouUnit['kind'] }) => (n.member ? `${n.pou}.${n.member}${n.kind === 'property' ? '' : '()'}` : `${n.pou}`);
