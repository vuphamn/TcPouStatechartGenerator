/**
 * Structured Text Find & Highlighting Utility
 * Provides fast, safe string and variable search and highlighting for
 * IEC 61131-3 / TwinCAT Structured Text declaration and implementation editors.
 */

export interface FindMatch {
  id: string;
  target: 'implementation' | 'declaration';
  targetIndex: number; // 0-based index among matches in this specific window
  globalIndex: number; // 0-based index across all matches
  originalLineNumber: number; // 1-based line number in original code
  columnIndex: number; // 0-based column index
  matchLength: number;
  matchedText: string;
  linePreview: string;
}

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

/**
 * Escapes characters for regex usage
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a search regex for the given query, case option, and whole word option.
 */
export function buildSearchRegex(query: string, matchCase: boolean, wholeWord: boolean): RegExp | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  try {
    let pattern = escapeRegex(trimmed);
    // Support HTML entities if searching for comparison operators like <, >, &
    pattern = pattern
      .replace(/</g, '(?:<|&lt;)')
      .replace(/>/g, '(?:>|&gt;)')
      .replace(/&/g, '(?:&|&amp;)');

    if (wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
    return new RegExp(pattern, matchCase ? 'g' : 'gi');
  } catch {
    return null;
  }
}

/**
 * Finds all matches of a query in raw Structured Text code.
 */
export function findMatchesInCode(
  code: string,
  query: string,
  target: 'implementation' | 'declaration',
  options: FindOptions
): FindMatch[] {
  if (!code || !query || !query.trim()) return [];

  const trimmed = query.trim();
  const searchRegex = buildSearchRegex(trimmed, options.matchCase, options.wholeWord);
  if (!searchRegex) return [];

  const lines = code.split('\n');
  const matches: FindMatch[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineText = lines[lineIdx];
    const lineNum = lineIdx + 1; // 1-based
    searchRegex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = searchRegex.exec(lineText)) !== null) {
      matches.push({
        id: `${target}-${lineNum}-${match.index}`,
        target,
        targetIndex: matches.length,
        globalIndex: 0, // will be assigned when merging
        originalLineNumber: lineNum,
        columnIndex: match.index,
        matchLength: match[0].length,
        matchedText: match[0],
        linePreview: lineText.trim(),
      });

      // Avoid infinite loop on zero-width match
      if (match.index === searchRegex.lastIndex) {
        searchRegex.lastIndex++;
      }
    }
  }

  return matches;
}

/**
 * Safely highlights matches inside Prism-generated HTML without corrupting
 * HTML tags, element attributes, or changing character spacing.
 */
export function highlightHtmlWithFindMatches(
  prismHtml: string,
  query: string,
  options: FindOptions,
  activeMatchTargetIndex: number = -1
): { html: string; matchCount: number } {
  if (!prismHtml || !query || !query.trim()) {
    return { html: prismHtml, matchCount: 0 };
  }

  const searchRegex = buildSearchRegex(query.trim(), options.matchCase, options.wholeWord);
  if (!searchRegex) {
    return { html: prismHtml, matchCount: 0 };
  }

  let matchCounter = 0;

  // Split HTML stream into tags (<...>) and inner text nodes ([^<]+)
  const highlightedHtml = prismHtml.replace(/(<[^>]+>)|([^<]+)/g, (full, tag, textNode) => {
    if (tag) {
      // Return HTML tag unmodified to avoid corrupting tokens or attributes
      return tag;
    }

    // Replace matches only inside pure text nodes
    searchRegex.lastIndex = 0;
    return textNode.replace(searchRegex, (matchedStr: string) => {
      const isActive = matchCounter === activeMatchTargetIndex;
      matchCounter++;

      // Strict monospace preservation styles: 0 padding, 0 margin, border via box-shadow/outline
      const activeStyle =
        'background-color:#f59e0b;color:#0f172a;outline:2px solid #fbbf24;outline-offset:0px;border-radius:2px;font-weight:700;display:inline;';
      const normalStyle =
        'background-color:rgba(250,204,21,0.38);color:#fef08a;outline:1px solid rgba(234,179,8,0.75);outline-offset:0px;border-radius:2px;display:inline;';

      const appliedStyle = isActive ? activeStyle : normalStyle;
      const appliedClass = isActive
        ? 'find-match-active transition-all'
        : 'find-match transition-all';

      return `<mark class="${appliedClass}" style="${appliedStyle}">${matchedStr}</mark>`;
    });
  });

  return { html: highlightedHtml, matchCount: matchCounter };
}


export interface SearchVariable {
  name: string;
  /** Where it is declared: the state variable, the method's VAR blocks, the POU's, or only used in the code */
  source: 'state' | 'method' | 'pou' | 'code';
  /** The declared type, e.g. BOOL, TON, E_FeedMode */
  type?: string;
  /** Whole-word uses in the implementation (any case, as ST is) */
  uses: number;
}

const ST_KEYWORDS = new Set([
  'CASE', 'OF', 'END_CASE', 'IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF', 'FOR', 'TO', 'BY', 'DO', 'END_FOR', 'WHILE',
  'END_WHILE', 'REPEAT', 'UNTIL', 'RETURN', 'TRUE', 'FALSE', 'AND', 'OR', 'XOR', 'NOT', 'MOD', 'EXIT', 'CONTINUE',
]);

/** Name -> type of the variables in a declaration's VAR blocks (comments and attributes skipped) */
function declaredVariables(declaration: string): Map<string, string> {
  const out = new Map<string, string>();
  const text = declaration.replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/\{[^}]*\}/g, ' ');
  let inVarBlock = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^VAR(_INPUT|_OUTPUT|_IN_OUT|_STAT|_TEMP|_INST)?\b/i.test(line)) {
      inVarBlock = true;
      continue;
    }
    if (/^END_VAR\b/i.test(line)) {
      inVarBlock = false;
      continue;
    }
    if (!inVarBlock) continue;
    // "bBusy : BOOL;", "a, b : INT := 5;", "fbTimer : TON;", "aX : ARRAY [1..5] OF INT;"
    const m = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?:AT\s+%\S+\s*)?:\s*([^;:=]+)/i);
    if (!m) continue;
    const type = m[2].trim().replace(/\s+/g, ' ');
    for (const name of m[1].split(',')) {
      const n = name.trim();
      if (n && !ST_KEYWORDS.has(n.toUpperCase()) && !out.has(n)) out.set(n, type);
    }
  }
  return out;
}

/**
 * Every variable worth searching for in a method: the state variable, the method's own variables, the POU's
 * (function block members), and prefixed names used in the code but declared elsewhere (bX, nX, sX, ...).
 */
export function collectSearchVariables(
  methodDeclaration: string,
  pouDeclaration: string,
  implementation: string,
  stateVar?: string
): SearchVariable[] {
  const code = implementation.replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const counts = new Map<string, number>();
  for (const w of code.match(/\b[A-Za-z_]\w*\b/g) ?? []) counts.set(w.toLowerCase(), (counts.get(w.toLowerCase()) ?? 0) + 1);
  const uses = (n: string) => counts.get(n.toLowerCase()) ?? 0;

  const byName = new Map<string, SearchVariable>();
  const add = (name: string, source: SearchVariable['source'], type?: string) => {
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { name, source, type, uses: uses(name) });
  };
  const method = declaredVariables(methodDeclaration);
  const pou = declaredVariables(pouDeclaration);
  const state = stateVar?.trim();
  if (state) add(state, 'state', pou.get(state) ?? method.get(state));
  for (const [n, t] of method) add(n, 'method', t);
  for (const [n, t] of pou) add(n, 'pou', t);
  for (const m of code.match(/\b[bnsudrefi][A-Z][A-Za-z0-9_]*\b/g) ?? []) {
    if (m.length >= 3 && m.length <= 40 && !ST_KEYWORDS.has(m.toUpperCase())) add(m, 'code');
  }
  const order = { state: 0, method: 1, pou: 2, code: 3 };
  return [...byName.values()].sort((a, b) => order[a.source] - order[b.source] || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
