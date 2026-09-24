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

/**
 * Extracts variable names from Structured Text declaration and code
 * to provide quick search suggestions for variables (e.g. machineState, bBusy, etc.)
 */
export function extractVariablesForSuggestions(
  declaration: string,
  implementation: string,
  knownStateVar?: string
): string[] {
  const vars = new Set<string>();

  if (knownStateVar && knownStateVar.trim()) {
    vars.add(knownStateVar.trim());
  }

  // Parse variable declarations in declaration text:
  // VAR / VAR_INPUT / VAR_OUTPUT ... <varName> : <type> ... END_VAR
  const declLines = declaration.split('\n');
  let inVarBlock = false;

  for (const rawLine of declLines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('(*')) continue;

    if (/\b(VAR|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_STAT|VAR_TEMP)\b/i.test(line)) {
      inVarBlock = true;
      continue;
    }
    if (/\bEND_VAR\b/i.test(line)) {
      inVarBlock = false;
      continue;
    }

    if (inVarBlock) {
      // Match "bBusy : BOOL;" or "stateVar, nextState : INT;"
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const leftPart = line.substring(0, colonIdx).trim();
        const names = leftPart.split(',');
        for (const name of names) {
          const cleanName = name.trim().replace(/^\[.*?\]/, '');
          if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleanName)) {
            vars.add(cleanName);
          }
        }
      }
    }
  }

  // Also check common PLC prefixes and patterns in implementation
  const implMatches = implementation.match(/\b([bnsudre][A-Z][a-zA-Z0-9_]*)\b/g);
  if (implMatches) {
    for (const m of implMatches) {
      if (m.length >= 3 && m.length <= 32) {
        vars.add(m);
      }
    }
  }

  // Standard IEC ST keywords to exclude from variable suggestions
  const keywords = new Set([
    'CASE',
    'OF',
    'END_CASE',
    'IF',
    'THEN',
    'ELSE',
    'ELSIF',
    'END_IF',
    'FOR',
    'TO',
    'BY',
    'DO',
    'END_FOR',
    'WHILE',
    'END_WHILE',
    'REPEAT',
    'UNTIL',
    'RETURN',
    'TRUE',
    'FALSE',
  ]);

  return Array.from(vars)
    .filter((v) => !keywords.has(v.toUpperCase()))
    .slice(0, 15);
}
