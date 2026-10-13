/**
 * What writing the edited files to the PLC would change, as XAE's Online Change details say before it writes (the
 * app's Build dialog; the VS Code extension's shared/onlineChangeCheck.cjs does the same for the whole project, tasks
 * and libraries too): each edited POU, DUT or GVL against the PLC's own copy: its declaration changed (its instances
 * move: pointers and references to them invalid until assigned again), its RETAIN / PERSISTENT variables added,
 * removed or of another type (their values lost or reinitialized), added (not on the PLC yet).
 */
export interface OnlineChangeRisks {
  interfaces: string[];
  retain: { object: string; name: string; change: string }[];
  added: string[];
}

const stripComments = (st: string) => st.replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
const normal = (st: string) => stripComments(st).replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

function declarationOf(xml: string): { name: string | null; decl: string } {
  const name = /<(?:POU|DUT|GVL|Itf)\b[^>]*\bName="([^"]+)"/i.exec(xml)?.[1] ?? null;
  return { name, decl: /<Declaration>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Declaration>/i.exec(xml)?.[1] ?? '' };
}

/** A declaration's RETAIN / PERSISTENT variables → name (lower case) → { name, type, kind } */
export function retainVars(decl: string): Map<string, { name: string; type: string; kind: string }> {
  const out = new Map<string, { name: string; type: string; kind: string }>();
  for (const m of stripComments(decl).matchAll(/\bVAR(?:_GLOBAL|_INPUT|_OUTPUT|_IN_OUT|_STAT)?\b([^\n;]*?)\n([\s\S]*?)\bEND_VAR\b/gi)) {
    const kind = /\bPERSISTENT\b/i.test(m[1]) ? 'PERSISTENT' : /\bRETAIN\b/i.test(m[1]) ? 'RETAIN' : null;
    if (!kind) continue;
    for (const d of m[2].split(';')) {
      const v = /^\s*([A-Za-z_][\w,\s]*?)\s*(?:AT\s+%[\w.*]+\s*)?:\s*([^:=]+?)\s*(?::=[\s\S]*)?$/i.exec(d.replace(/\{[^}]*\}/g, ' '));
      if (!v) continue;
      for (const n of v[1].split(',').map((x) => x.trim()).filter(Boolean)) out.set(n.toLowerCase(), { name: n, type: v[2].replace(/\s+/g, ' ').trim(), kind });
    }
  }
  return out;
}

/** The edited files against the PLC's: [{ path, content }] each → the risks (the PLC's file missing: added) */
export function onlineChangeRisks(edited: { path: string; content: string }[], onPlc: (path: string) => string | null): OnlineChangeRisks {
  const out: OnlineChangeRisks = { interfaces: [], retain: [], added: [] };
  for (const f of edited) {
    const now = declarationOf(f.content);
    const name = now.name ?? f.path.split(/[\\/]/).pop()!.replace(/\.\w+$/, '');
    const was = onPlc(f.path);
    if (was === null) {
      out.added.push(name);
      continue;
    }
    const before = declarationOf(was);
    if (normal(now.decl) !== normal(before.decl)) out.interfaces.push(name);
    const ra = retainVars(now.decl);
    const rb = retainVars(before.decl);
    for (const [k, v] of ra) {
      const b = rb.get(k);
      if (!b) out.retain.push({ object: name, name: v.name, change: `${v.kind} added` });
      else if (b.type.toLowerCase() !== v.type.toLowerCase()) out.retain.push({ object: name, name: v.name, change: `${b.type} → ${v.type}` });
    }
    for (const [k, v] of rb) if (!ra.has(k)) out.retain.push({ object: name, name: v.name, change: `no longer ${v.kind}` });
  }
  return out;
}
