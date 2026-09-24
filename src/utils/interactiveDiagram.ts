import { extractPriorityFromText, extractCleanCondition } from './diagramNotes.ts';

/**
 * Compacts an edge label for interactive mode to provide a cleaner layout
 * for complex state machines while keeping priority symbols and indicating interactive expandability.
 */
export function compactLabelForInteractiveMode(rawLabel?: string, maxLen = 24): string {
  if (!rawLabel) return '';
  const trimmed = rawLabel.trim();
  const prio = extractPriorityFromText(trimmed);
  const clean = extractCleanCondition(trimmed);

  const prioPrefix = prio ? `${prio.symbol} ` : '';

  // If already short, return with subtle expand indicator if appropriate
  if (clean.length <= maxLen) {
    return `${prioPrefix}${clean}`;
  }

  // Attempt to split by top-level AND/OR to show the primary guard
  const parts = clean.split(/\s+(?:AND|OR)\s+/i);
  let base = parts[0].trim();
  if (base.startsWith('(') && base.endsWith(')')) {
    base = base.slice(1, -1).trim();
  }

  if (base.length > maxLen - 4) {
    base = base.slice(0, maxLen - 4).trim() + '...';
  } else if (parts.length > 1) {
    base = `${base} (+${parts.length - 1})`;
  }

  return `${prioPrefix}${base} ▾`;
}

/**
 * Transforms Mermaid markdown source by compacting edge labels for interactive mode rendering.
 */
export function createInteractiveMermaidCode(code: string, isCompact = true, maxLen = 24): string {
  if (!code || !isCompact) return code;

  const isFlowchart = code.includes('flowchart') || code.includes('graph');

  if (isFlowchart) {
    // Flowchart edge labels: -->|Label| or -->|"Label"| or -.->|Label| etc.
    return code.replace(
      /(^\s*[A-Za-z0-9_.-]+(?:\[[^\]]*\]|\({1,2}[^)]*\){1,2}|\{[^}]*\})*\s*(?:-->|-.->|==>|---|--)\s*\|"?)([\s\S]*?)("?\|\s*[A-Za-z0-9_.-]+)/gm,
      (full, p1, label, p2) => {
        const compacted = compactLabelForInteractiveMode(label, maxLen);
        // Replace unescaped double quotes inside the label with single quotes so they don't break |"..."|
        const safeCompacted = compacted.replace(/"/g, "'").replace(/\n/g, '<br/>');
        const prefix = p1.endsWith('"') ? p1 : `${p1}"`;
        const suffix = p2.startsWith('"') ? p2 : `"${p2}`;
        return `${prefix}${safeCompacted}${suffix}`;
      }
    );
  } else {
    // stateDiagram-v2: From --> To: Label
    return code.replace(
      /(^\s*(?:[A-Za-z0-9_.-]+|\[\*\])\s*-->\s*(?:[A-Za-z0-9_.-]+|\[\*\])\s*:\s*)([^\n]+)/gm,
      (full, p1, label) => {
        const compacted = compactLabelForInteractiveMode(label, maxLen);
        // For stateDiagram-v2, escape colons and clean newlines
        const safeCompacted = compacted.replace(/:/g, '\\:').replace(/[\r\n]+/g, ' ');
        return `${p1}${safeCompacted}`;
      }
    );
  }
}

export interface ParsedConditionInfo {
  raw: string;
  isElse: boolean;
  isPriorityOnly: boolean;
  clauses: string[];
  operators: string[];
}

/**
 * Parses a transition guard condition into structured clauses and logical operators.
 */
export function parseConditionClauses(condition: string): ParsedConditionInfo {
  const trimmed = condition.trim();
  if (!trimmed) {
    return { raw: '', isElse: false, isPriorityOnly: false, clauses: [], operators: [] };
  }

  if (trimmed.toLowerCase() === 'else') {
    return { raw: trimmed, isElse: true, isPriorityOnly: false, clauses: ['else'], operators: [] };
  }

  const clauses: string[] = [];
  const operators: string[] = [];

  let parenDepth = 0;
  let buffer = '';
  let i = 0;

  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (ch === '(') {
      parenDepth++;
      buffer += ch;
      i++;
    } else if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      buffer += ch;
      i++;
    } else if (parenDepth === 0) {
      const rest = trimmed.slice(i);
      const andMatch = rest.match(/^\s+(AND|AND_THEN)\s+/i);
      const orMatch = rest.match(/^\s+(OR|OR_ELSE|XOR)\s+/i);
      if (andMatch) {
        if (buffer.trim()) clauses.push(cleanClause(buffer));
        operators.push(andMatch[1].toUpperCase());
        buffer = '';
        i += andMatch[0].length;
      } else if (orMatch) {
        if (buffer.trim()) clauses.push(cleanClause(buffer));
        operators.push(orMatch[1].toUpperCase());
        buffer = '';
        i += orMatch[0].length;
      } else {
        buffer += ch;
        i++;
      }
    } else {
      buffer += ch;
      i++;
    }
  }

  if (buffer.trim()) {
    clauses.push(cleanClause(buffer));
  }

  return {
    raw: trimmed,
    isElse: false,
    isPriorityOnly: clauses.length === 0,
    clauses: clauses.filter(Boolean),
    operators,
  };
}

function cleanClause(c: string): string {
  let s = c.trim();
  if (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let matchAll = true;
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      if (depth === 0) {
        matchAll = false;
        break;
      }
    }
    if (matchAll) s = s.slice(1, -1).trim();
  }
  return s;
}
