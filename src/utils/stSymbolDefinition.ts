/**
 * Utility functions for IEC 61131-3 / TwinCAT Structured Text symbol definition resolution.
 * Supports finding variable declarations, method declarations, and POU member definitions.
 */

export interface SymbolDeclarationMatch {
  scope: 'method' | 'pou' | 'case' | 'method_jump';
  symbol: string;
  lineNumber: number; // 1-based line number
  lineText: string;
  kind: 'variable' | 'method' | 'state_case' | 'type';
  signature?: string;
}

/**
 * Extracts the top-level POU Declaration from a .TcPOU XML string.
 * This is the <Declaration> block directly under <POU>, containing FUNCTION_BLOCK/PROGRAM
 * member variables (VAR_INPUT, VAR_OUTPUT, VAR, etc.), distinct from individual method declarations.
 */
export function extractPouDeclaration(pouXml: string): string {
  if (!pouXml || !pouXml.trim()) return '';

  const pouMatch = pouXml.match(/<POU\b[^>]*>([\s\S]*?)<\/POU>/i);
  if (!pouMatch) return '';

  const pouInner = pouMatch[1];
  // Strip out all <Method>...</Method> tags so we only have the POU-level declaration
  const withoutMethods = pouInner.replace(/<Method\b[\s\S]*?<\/Method>/gi, '');

  const declMatch = withoutMethods.match(/<Declaration[^>]*>([\s\S]*?)<\/Declaration>/i);
  if (declMatch) {
    const raw = declMatch[1];
    const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
    return cdata ? cdata[1] : raw;
  }

  return '';
}

/**
 * Detects the word/identifier at a given cursor position inside a Structured Text buffer.
 * Supports IEC 61131-3 identifiers ([A-Za-z0-9_]) and dot-delimited member expressions.
 */
export function getWordAtPosition(
  text: string,
  pos: number
): { word: string; start: number; end: number; fullExpr?: string } | null {
  if (!text || pos < 0 || pos > text.length) return null;

  const isIdentChar = (ch: string) => /[A-Za-z0-9_]/.test(ch);

  // If pos is on a non-identifier char, check pos - 1
  let targetPos = pos;
  if (targetPos >= text.length || !isIdentChar(text[targetPos])) {
    if (targetPos > 0 && isIdentChar(text[targetPos - 1])) {
      targetPos--;
    } else {
      return null;
    }
  }

  let start = targetPos;
  while (start > 0 && isIdentChar(text[start - 1])) {
    start--;
  }

  let end = targetPos;
  while (end < text.length && isIdentChar(text[end])) {
    end++;
  }

  const word = text.slice(start, end).trim();
  if (!word) return null;

  // Also check if part of a dotted expression (e.g. fbRunningDoor.bValidData)
  let exprStart = start;
  while (exprStart > 0 && (isIdentChar(text[exprStart - 1]) || text[exprStart - 1] === '.')) {
    exprStart--;
  }
  let exprEnd = end;
  while (exprEnd < text.length && (isIdentChar(text[exprEnd]) || text[exprEnd] === '.')) {
    exprEnd++;
  }

  const fullExpr = text.slice(exprStart, exprEnd).trim();

  return {
    word,
    start,
    end,
    fullExpr: fullExpr !== word ? fullExpr : undefined,
  };
}

/**
 * Resolves the target symbol from a textarea selection or caret position.
 */
export function resolveSymbolFromText(
  text: string,
  selectionStart: number,
  selectionEnd: number
): { symbol: string; memberOf?: string } | null {
  if (!text) return null;

  // If user selected text explicitly
  if (selectionEnd > selectionStart) {
    const selected = text.slice(selectionStart, selectionEnd).trim();
    // Strip trailing parens or punctuation if selected accidentally (e.g. "myVar;" -> "myVar")
    const cleaned = selected.replace(/^[^\w]+|[^\w]+$/g, '');
    if (cleaned && /^[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned)) {
      return { symbol: cleaned };
    }
  }

  // Fallback to word at caret
  const wordInfo = getWordAtPosition(text, selectionStart);
  if (wordInfo) {
    let memberOf: string | undefined;
    if (wordInfo.fullExpr && wordInfo.fullExpr.includes('.')) {
      const parts = wordInfo.fullExpr.split('.');
      const idx = parts.indexOf(wordInfo.word);
      if (idx > 0) {
        memberOf = parts[idx - 1];
      }
    }
    return {
      symbol: wordInfo.word,
      memberOf,
    };
  }

  return null;
}

/**
 * Searches a Structured Text declaration block (Method Declaration or POU Declaration)
 * for the declaration line of a variable or function.
 * Returns the 1-based line number and metadata if found.
 */
export function findSymbolDeclarationLine(
  declarationCode: string,
  symbol: string
): { lineNumber: number; lineText: string; kind: 'variable' | 'method' | 'pou' | 'type' } | null {
  if (!declarationCode || !symbol) return null;
  const cleanSym = symbol.trim();
  if (!cleanSym) return null;

  // Escape regex special chars
  const escapedSym = cleanSym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const lines = declarationCode.split('\n');

  // IEC 61131-3 variable declaration regexes (case-insensitive):
  // 1. Symbol at start of declaration line:
  //    e.g. "ton_TimeToStop : TON;"
  //    e.g. "di_DoorSense AT %I*: BOOL;"
  //    e.g. "cmd_bHome : BOOL := FALSE;"
  const varLeadingRegex = new RegExp(
    `^[\\t ]*(?:[A-Za-z0-9_]+[\\t ]*,[\\t ]*)*\\b${escapedSym}\\b(?:[\\t ]*,[\\t ]*[A-Za-z0-9_]+)*[\\t ]*(?:AT[\\t ]+%[A-Za-z0-9_*.]+)?[\\t ]*:[^=]`,
    'i'
  );

  // 2. Method or Function declaration header:
  //    e.g. "METHOD doState : BOOL"
  //    e.g. "METHOD PUBLIC doState"
  //    e.g. "FUNCTION_BLOCK SM_TableManager"
  const headerRegex = new RegExp(
    `^[\\t ]*(?:METHOD|FUNCTION|FUNCTION_BLOCK|PROGRAM|TYPE)[\\t ]+(?:(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|FINAL|ABSTRACT)[\\t ]+)*\\b${escapedSym}\\b`,
    'i'
  );

  // 3. Fallback variable pattern anywhere before ':' or ':='
  const fallbackVarRegex = new RegExp(
    `\\b${escapedSym}\\b[\\t ]*(?:AT[\\t ]+%[A-Za-z0-9_*.]+)?[\\t ]*:`,
    'i'
  );

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Skip full comment lines
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('(*') && trimmed.endsWith('*)')) continue;

    // Strip comments for matching
    const stripped = rawLine.replace(/\/\/.*/, '').replace(/\(\*.*?\*\)/g, '');

    if (varLeadingRegex.test(stripped)) {
      return {
        lineNumber: i + 1,
        lineText: trimmed,
        kind: 'variable',
      };
    }

    if (headerRegex.test(stripped)) {
      return {
        lineNumber: i + 1,
        lineText: trimmed,
        kind: 'method',
      };
    }

    if (fallbackVarRegex.test(stripped)) {
      return {
        lineNumber: i + 1,
        lineText: trimmed,
        kind: 'variable',
      };
    }
  }

  return null;
}
