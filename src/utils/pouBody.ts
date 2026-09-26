/**
 * The POU's own code (not its methods): the declaration (FUNCTION_BLOCK ... VAR_INPUT ... END_VAR ...) and the body
 * (the POU's implementation), as TwinCAT keeps them in the .TcPOU: the first <Declaration> and <Implementation>
 * after <POU>, before its first Method / Property / Action / Transition.
 */

export interface PouBody {
  found: boolean;
  /** The POU's name (SM_TableManager) */
  name: string;
  /** FUNCTION_BLOCK, PROGRAM, FUNCTION, ... (from the declaration) */
  kind: string;
  /** EXTENDS / IMPLEMENTS from the declaration */
  extendsName?: string;
  declaration: string;
  implementation: string;
  /** false: the body is not Structured Text (language: its element, e.g. "SFC") */
  isStructuredText: boolean;
  language?: string;
  methodCount: number;
  error?: string;
}

const CHILD_START = /<(Method|Property|Action|Transition|LineIds|Folder)\b/i;

/** The POU element's own part: [start, end) after its opening tag, before its first child object */
function ownRegion(pouXml: string): { start: number; end: number; name: string } | null {
  const open = pouXml.match(/<POU\b[^>]*>/i);
  if (!open || open.index === undefined) return null;
  const start = open.index + open[0].length;
  const rest = pouXml.slice(start);
  const child = rest.search(CHILD_START);
  const close = rest.search(/<\/POU>/i);
  const endRel = [child, close].filter((i) => i >= 0).reduce((a, b) => Math.min(a, b), rest.length);
  return { start, end: start + endRel, name: open[0].match(/\bName=["']([^"']+)["']/i)?.[1] ?? '' };
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The text of an element's content: its CDATA, else its XML-decoded text */
const textOf = (inner: string) => {
  const cdata = inner.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return cdata ? cdata[1] : decodeXml(inner.trim());
};

export function getPouBody(pouXml: string): PouBody {
  const empty: PouBody = { found: false, name: '', kind: '', declaration: '', implementation: '', isStructuredText: true, methodCount: 0 };
  if (!pouXml || !pouXml.trim()) return { ...empty, error: 'No .TcPOU loaded' };
  const region = ownRegion(pouXml);
  if (!region) return { ...empty, error: 'No <POU> element in the file' };
  const own = pouXml.slice(region.start, region.end);
  const decl = own.match(/<Declaration[^>]*>([\s\S]*?)<\/Declaration>/i);
  const impl = own.match(/<Implementation[^>]*>([\s\S]*?)<\/Implementation>/i);
  const declaration = decl ? textOf(decl[1]) : '';
  const st = impl ? impl[1].match(/<ST[^>]*>([\s\S]*?)<\/ST>/i) : null;
  const other = impl && !st ? impl[1].match(/<([A-Za-z]+)\b/)?.[1] : undefined;
  const head = declaration.replace(/\(\*[\s\S]*?\*\)|\/\/[^\n]*|\{[^}\n]*\}/g, ' ');
  const kind = head.match(/^\s*(FUNCTION_BLOCK|PROGRAM|FUNCTION|INTERFACE)\b/im)?.[1]?.toUpperCase() ?? '';
  return {
    found: true,
    name: region.name,
    kind,
    extendsName: head.match(/\bEXTENDS\s+([A-Za-z_][\w.]*)/i)?.[1],
    declaration,
    implementation: st ? textOf(st[1]) : '',
    isStructuredText: !other,
    language: other,
    methodCount: (pouXml.match(/<Method\b/gi) || []).length,
  };
}

export interface UpdatePouBodyResult {
  success: boolean;
  updatedPou: string;
  error?: string;
}

/**
 * Replaces the POU's own declaration and body (Structured Text; null leaves the body as it is, e.g. an SFC body);
 * its methods are left as they are
 */
export function updatePouBody(pouXml: string, declaration: string, implementation: string | null): UpdatePouBodyResult {
  if (declaration.includes(']]>') || (implementation ?? '').includes(']]>')) {
    return { success: false, updatedPou: pouXml, error: 'The code contains "]]>", which a .TcPOU cannot hold' };
  }
  const region = ownRegion(pouXml);
  if (!region) return { success: false, updatedPou: pouXml, error: 'No <POU> element in the file' };
  let own = pouXml.slice(region.start, region.end);

  const declRx = /(<Declaration[^>]*>)([\s\S]*?)(<\/Declaration>)/i;
  if (declRx.test(own)) own = own.replace(declRx, (_m, a: string, _b: string, c: string) => `${a}<![CDATA[${declaration}]]>${c}`);
  else own = `\n    <Declaration><![CDATA[${declaration}]]></Declaration>${own}`;

  const implRx = /(<Implementation[^>]*>)([\s\S]*?)(<\/Implementation>)/i;
  const impl = implementation === null ? null : own.match(implRx);
  if (implementation === null) {
    // the body stays as it is
  } else if (impl) {
    const stRx = /(<ST[^>]*>)([\s\S]*?)(<\/ST>)/i;
    if (stRx.test(impl[2])) {
      const inner = impl[2].replace(stRx, (_m, a: string, _b: string, c: string) => `${a}<![CDATA[${implementation}]]>${c}`);
      own = own.replace(implRx, (_m, a: string, _b: string, c: string) => `${a}${inner}${c}`);
    } else if (!impl[2].trim()) {
      own = own.replace(implRx, (_m, a: string, _b: string, c: string) => `${a}\n      <ST><![CDATA[${implementation}]]></ST>\n    ${c}`);
    } else {
      return { success: false, updatedPou: pouXml, error: 'The POU body is not Structured Text: it cannot be saved from here' };
    }
  } else {
    // After the declaration
    own = own.replace(/(<\/Declaration>)/i, `$1\n    <Implementation>\n      <ST><![CDATA[${implementation}]]></ST>\n    </Implementation>`);
  }
  return { success: true, updatedPou: pouXml.slice(0, region.start) + own + pouXml.slice(region.end) };
}
