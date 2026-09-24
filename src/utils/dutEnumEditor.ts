/**
 * Utility for parsing, validating, formatting, and updating Beckhoff TwinCAT 3 .TcDUT (Enum / Data Unit Type) files.
 */

export interface ParsedEnumItem {
  id: string;
  name: string;
  value?: string;
  comment?: string;
  group?: string;
  line: number;
  isCommentedOut?: boolean;
}

export interface DutSyntaxDiagnostic {
  line: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ParsedDutResult {
  isXml: boolean;
  dutName: string;
  dutId: string;
  version: string;
  productVersion: string;
  attributes: string[];
  baseType: string;
  declaration: string;
  rawContent: string;
  enumItems: ParsedEnumItem[];
  groups: string[];
  diagnostics: DutSyntaxDiagnostic[];
  isValid: boolean;
}

/**
 * Extracts clean Structured Text declaration from .TcDUT XML content or raw text.
 */
export function extractDutDeclaration(content: string): string {
  if (!content) return '';
  const clean = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  // Try CDATA inside <Declaration>
  const cdataMatch = clean.match(/<Declaration[^>]*>[\s\S]*?<!\[CDATA\[([\s\S]*?)\]\]>[\s\S]*?<\/Declaration>/i);
  if (cdataMatch) {
    return cdataMatch[1].trim();
  }

  // Try standard <Declaration>...</Declaration>
  const declMatch = clean.match(/<Declaration[^>]*>([\s\S]*?)<\/Declaration>/i);
  if (declMatch) {
    return declMatch[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim();
  }

  // Fallback to raw text
  return clean.trim();
}

/**
 * Parses a .TcDUT file content into structured model and diagnostics.
 */
export function parseDutContent(content: string): ParsedDutResult {
  const clean = content ? (content.charCodeAt(0) === 0xfeff ? content.slice(1) : content) : '';
  const isXml = /<TcPlcObject/i.test(clean) && /<DUT/i.test(clean);

  let dutName = 'E_States';
  let dutId = '{00000000-0000-0000-0000-000000000000}';
  let version = '1.1.0.1';
  let productVersion = '3.1.4024.13';

  if (isXml) {
    const dutMatch = clean.match(/<DUT[^>]*\bName=["']([^"']+)["']/i);
    if (dutMatch) dutName = dutMatch[1];

    const idMatch = clean.match(/<DUT[^>]*\bId=["']([^"']+)["']/i);
    if (idMatch) dutId = idMatch[1];

    const verMatch = clean.match(/<TcPlcObject[^>]*\bVersion=["']([^"']+)["']/i);
    if (verMatch) version = verMatch[1];

    const prodMatch = clean.match(/<TcPlcObject[^>]*\bProductVersion=["']([^"']+)["']/i);
    if (prodMatch) productVersion = prodMatch[1];
  }

  const declaration = extractDutDeclaration(clean);

  // If not extracted from XML, try finding name in declaration: TYPE <Name> :
  const typeMatch = declaration.match(/\bTYPE\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/i);
  if (typeMatch) {
    dutName = typeMatch[1];
  }

  // Extract pragmas / attributes e.g. {attribute 'qualified_only'}
  const attributes: string[] = [];
  const attrRx = /\{attribute\s+['"][^'"]+['"]\}/gi;
  let attrM: RegExpExecArray | null;
  while ((attrM = attrRx.exec(declaration)) !== null) {
    attributes.push(attrM[0]);
  }

  // Extract base type e.g. ) DINT; or ) INT;
  let baseType = '';
  const baseTypeMatch = declaration.match(/\)\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/);
  if (baseTypeMatch && !['END_TYPE'].includes(baseTypeMatch[1].toUpperCase())) {
    baseType = baseTypeMatch[1];
  }

  // Parse enum items, groups, and diagnostics
  const { enumItems, groups, diagnostics } = parseDeclarationItems(declaration);

  return {
    isXml,
    dutName,
    dutId,
    version,
    productVersion,
    attributes,
    baseType,
    declaration,
    rawContent: clean,
    enumItems,
    groups,
    diagnostics,
    isValid: !diagnostics.some((d) => d.severity === 'error'),
  };
}

/**
 * Parses individual enum items, categories, and syntax checks from Structured Text declaration.
 */
function parseDeclarationItems(declaration: string): {
  enumItems: ParsedEnumItem[];
  groups: string[];
  diagnostics: DutSyntaxDiagnostic[];
} {
  const enumItems: ParsedEnumItem[] = [];
  const groups: string[] = [];
  const diagnostics: DutSyntaxDiagnostic[] = [];

  if (!declaration || !declaration.trim()) {
    diagnostics.push({
      line: 1,
      message: 'DUT declaration is empty.',
      severity: 'error',
    });
    return { enumItems, groups, diagnostics };
  }

  const lines = declaration.split(/\r?\n/);
  const typeIndex = declaration.search(/\bTYPE\b/i);
  const endTypeIndex = declaration.search(/\bEND_TYPE\b/i);

  if (typeIndex < 0) {
    diagnostics.push({
      line: 1,
      message: "Missing 'TYPE' keyword in declaration.",
      severity: 'error',
    });
  }

  if (endTypeIndex < 0) {
    diagnostics.push({
      line: lines.length,
      message: "Missing 'END_TYPE' keyword at end of declaration.",
      severity: 'error',
    });
  }

  const openParenIndex = declaration.indexOf('(');
  const closeParenIndex = declaration.lastIndexOf(')');

  if (openParenIndex < 0) {
    diagnostics.push({
      line: 1,
      message: "Missing opening parenthesis '(' for enum member list.",
      severity: 'error',
    });
  }

  if (closeParenIndex < 0 || closeParenIndex <= openParenIndex) {
    diagnostics.push({
      line: lines.length,
      message: "Missing closing parenthesis ')' for enum member list.",
      severity: 'error',
    });
  }

  let inEnumBlock = false;
  let currentGroup = '';
  const seenNames = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Check opening parenthesis
    if (trimmed.includes('(') && !inEnumBlock) {
      inEnumBlock = true;
    }

    // Check section comment headers like (* Section Name *) or // Section Name
    const blockCommentMatch = trimmed.match(/^\(\*\s*([^*]+?)\s*\*\)$/);
    if (blockCommentMatch) {
      const gName = blockCommentMatch[1].trim();
      if (!gName.toLowerCase().includes('declaration') && !gName.toLowerCase().includes('type')) {
        currentGroup = gName;
        if (!groups.includes(gName)) groups.push(gName);
      }
      continue;
    }

    // Check single line // Section comment header
    const lineCommentHeader = trimmed.match(/^\/\/\s*([^\/].*)$/);
    if (lineCommentHeader && !trimmed.includes(',')) {
      const text = lineCommentHeader[1].trim();
      if (text.length > 2 && !/^[A-Za-z_][A-Za-z0-9_]*\s*(:=|,)/.test(text)) {
        currentGroup = text;
        if (!groups.includes(text)) groups.push(text);
        continue;
      }
    }

    // Check if line is inside enum definition
    if (trimmed.startsWith('TYPE') || trimmed.startsWith('{attribute') || trimmed.startsWith('END_TYPE')) {
      continue;
    }

    // Check commented out enum item e.g. // TABLEMANAGER_FOO, or (* TABLEMANAGER_FOO *)
    const commentedOutMatch = trimmed.match(/^(?:\/\/|\(\*)\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s*:=\s*([0-9A-Fa-fx#]+))?\s*(?:,)?(?:\s*\*\))?/);
    if (commentedOutMatch && inEnumBlock) {
      const name = commentedOutMatch[1].trim();
      if (!['TYPE', 'END_TYPE', 'STRUCT', 'END_STRUCT', 'OF'].includes(name.toUpperCase())) {
        enumItems.push({
          id: `${name}_${lineNum}`,
          name,
          value: commentedOutMatch[2] ? commentedOutMatch[2].trim() : undefined,
          comment: 'Commented out',
          group: currentGroup || undefined,
          line: lineNum,
          isCommentedOut: true,
        });
        continue;
      }
    }

    // Standard enum item regex: IDENTIFIER [ := VALUE ] [ , ] [ (* COMMENT *) | // COMMENT ]
    const itemMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:=\s*([0-9A-Fa-fx#\-_]+))?(?:\s*,|\s*;|\s*$)?(?:\s*(?:\(\*([^*]+)\*\)|\/\/(.*)))?/);
    if (itemMatch) {
      const name = itemMatch[1].trim();
      const val = itemMatch[2] ? itemMatch[2].trim() : undefined;
      const inlineComment = (itemMatch[3] || itemMatch[4] || '').trim();

      // Skip keywords
      if (['TYPE', 'STRUCT', 'END_TYPE', 'END_STRUCT', 'ARRAY', 'OF'].includes(name.toUpperCase())) {
        continue;
      }

      // Check duplicates
      if (seenNames.has(name.toUpperCase())) {
        diagnostics.push({
          line: lineNum,
          message: `Duplicate enum identifier '${name}'.`,
          severity: 'error',
        });
      } else {
        seenNames.add(name.toUpperCase());
      }

      enumItems.push({
        id: `${name}_${lineNum}`,
        name,
        value: val,
        comment: inlineComment || undefined,
        group: currentGroup || undefined,
        line: lineNum,
        isCommentedOut: false,
      });
    } else if (inEnumBlock && !trimmed.startsWith(')') && !trimmed.startsWith('(')) {
      // Possible syntax error
      if (!trimmed.startsWith('//') && !trimmed.startsWith('(*')) {
        diagnostics.push({
          line: lineNum,
          message: `Unrecognized or invalid enum syntax on this line: "${trimmed.slice(0, 35)}"`,
          severity: 'warning',
        });
      }
    }

    if (trimmed.includes(')')) {
      inEnumBlock = false;
    }
  }

  // Check unclosed comments
  let openBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes('(*') && !l.includes('*)')) {
      openBlockComment = true;
    } else if (openBlockComment && l.includes('*)')) {
      openBlockComment = false;
    }
  }
  if (openBlockComment) {
    diagnostics.push({
      line: lines.length,
      message: "Unclosed comment block '(* ... *)'.",
      severity: 'error',
    });
  }

  return { enumItems, groups, diagnostics };
}

/**
 * Updates a .TcDUT file content with new Structured Text declaration.
 * Preserves XML tags, GUIDs, versions, and metadata if original was XML.
 */
export function updateDutDeclaration(originalContent: string, newDeclaration: string): string {
  const cleanOriginal = originalContent ? (originalContent.charCodeAt(0) === 0xfeff ? originalContent.slice(1) : originalContent) : '';
  const isXml = /<TcPlcObject/i.test(cleanOriginal) && /<DUT/i.test(cleanOriginal);

  // Extract new DUT Name if changed in TYPE <Name> :
  const typeMatch = newDeclaration.match(/\bTYPE\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/i);
  const newName = typeMatch ? typeMatch[1] : undefined;

  const normalizedDecl = newDeclaration.trim();

  if (!isXml) {
    return normalizedDecl;
  }

  let updatedXml = cleanOriginal;

  // 1. Update <DUT Name="..."> if name changed
  if (newName) {
    updatedXml = updatedXml.replace(
      /(<DUT[^>]*\bName=["'])([^"']+)(["'])/i,
      `$1${newName}$3`
    );
  }

  // 2. Replace <Declaration>...</Declaration>
  const hasCdata = /<Declaration[^>]*>[\s\S]*?<!\[CDATA\[/i.test(updatedXml);
  if (hasCdata) {
    updatedXml = updatedXml.replace(
      /(<Declaration[^>]*>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Declaration>)/i,
      `$1${normalizedDecl}\n$2`
    );
  } else {
    // If no CDATA was found, wrap inside CDATA for safe XML output
    updatedXml = updatedXml.replace(
      /(<Declaration[^>]*>)[\s\S]*?(<\/Declaration>)/i,
      `$1<![CDATA[${normalizedDecl}\n]]>$2`
    );
  }

  return updatedXml;
}

/**
 * Creates a standard TwinCAT 3 .TcDUT XML file from Structured Text declaration.
 */
export function wrapDeclarationInTcPlcObject(
  declaration: string,
  dutName: string = 'E_States',
  dutId?: string
): string {
  const guid = dutId || `{${crypto.randomUUID ? crypto.randomUUID() : 'a0b1c2d3-e4f5-6789-0123-456789abcdef'}}`;
  return `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1" ProductVersion="3.1.4024.13">
  <DUT Name="${dutName}" Id="${guid}">
    <Declaration><![CDATA[${declaration.trim()}]]></Declaration>
  </DUT>
</TcPlcObject>`;
}

/**
 * Formats Structured Text declaration with standard TwinCAT XAE styling:
 * - Proper indentation for members
 * - Clean section comment headers
 * - Aligned commas and comments
 */
export function formatStructuredTextDut(stCode: string): string {
  if (!stCode || !stCode.trim()) return '';

  const parsed = parseDutContent(stCode);
  const { enumItems, attributes, baseType, dutName } = parsed;

  const lines: string[] = [];

  // Add attributes
  if (attributes && attributes.length > 0) {
    attributes.forEach((attr) => lines.push(attr));
  } else {
    // Standard recommended TwinCAT attributes
    lines.push("{attribute 'qualified_only'}");
    lines.push("{attribute 'strict'}");
  }

  // TYPE E_Name : (
  lines.push(`TYPE ${dutName} : (`);

  let lastGroup = '';
  const activeItems = enumItems.filter((item) => !item.isCommentedOut);

  // If there are no parsed items, preserve original body with clean indentation
  if (activeItems.length === 0) {
    const rawLines = stCode.split(/\r?\n/);
    return rawLines
      .map((l) => (l.trim().length > 0 && !l.startsWith('TYPE') && !l.startsWith('END_TYPE') ? `\t${l.trim()}` : l.trim()))
      .join('\n');
  }

  activeItems.forEach((item, idx) => {
    // Add group header comment if group changed
    if (item.group && item.group !== lastGroup) {
      if (idx > 0) lines.push('');
      lines.push(`\t(* ${item.group} *)`);
      lastGroup = item.group;
    }

    const isLast = idx === activeItems.length - 1;
    let itemStr = `\t${item.name}`;

    if (item.value !== undefined && item.value !== '') {
      itemStr += ` := ${item.value}`;
    }

    if (!isLast) {
      itemStr += ',';
    }

    if (item.comment) {
      // Pad to standard column for aligned comments
      const padLength = Math.max(1, 40 - itemStr.length);
      const padding = '\t'.repeat(Math.ceil(padLength / 4));
      itemStr += `${padding}(* ${item.comment} *)`;
    }

    lines.push(itemStr);
  });

  // Closing );
  const closingType = baseType ? `) ${baseType};` : ');';
  lines.push(closingType);
  lines.push('END_TYPE');

  return lines.join('\n');
}

/**
 * Renumbers enum values with custom start and increment step (e.g. := 0, := 10, := 20...).
 * Passing clearValues = true removes all explicit ordinal assignments.
 */
export function renumberEnumValues(
  declaration: string,
  start: number = 0,
  step: number = 10,
  clearValues: boolean = false
): string {
  const parsed = parseDutContent(declaration);
  const { enumItems, attributes, baseType, dutName } = parsed;

  const lines: string[] = [];

  if (attributes && attributes.length > 0) {
    attributes.forEach((attr) => lines.push(attr));
  }

  lines.push(`TYPE ${dutName} : (`);

  let currentVal = start;
  let lastGroup = '';
  const activeItems = enumItems.filter((i) => !i.isCommentedOut);

  activeItems.forEach((item, idx) => {
    if (item.group && item.group !== lastGroup) {
      if (idx > 0) lines.push('');
      lines.push(`\t(* ${item.group} *)`);
      lastGroup = item.group;
    }

    const isLast = idx === activeItems.length - 1;
    let itemStr = `\t${item.name}`;

    if (!clearValues) {
      itemStr += ` := ${currentVal}`;
      currentVal += step;
    }

    if (!isLast) {
      itemStr += ',';
    }

    if (item.comment) {
      itemStr += `\t\t(* ${item.comment} *)`;
    }

    lines.push(itemStr);
  });

  const closingType = baseType ? `) ${baseType};` : ');';
  lines.push(closingType);
  lines.push('END_TYPE');

  return lines.join('\n');
}

/**
 * Sorts enum members alphabetically while optionally preserving group categories.
 */
export function sortEnumItemsInDeclaration(
  declaration: string,
  mode: 'alphabetical' | 'natural'
): string {
  const parsed = parseDutContent(declaration);
  const { enumItems, attributes, baseType, dutName, groups } = parsed;

  const lines: string[] = [];
  if (attributes && attributes.length > 0) {
    attributes.forEach((attr) => lines.push(attr));
  }

  lines.push(`TYPE ${dutName} : (`);

  let sortedItems: ParsedEnumItem[] = [];

  if (mode === 'alphabetical') {
    // Sort all active items strictly alphabetically
    sortedItems = [...enumItems.filter((i) => !i.isCommentedOut)].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
  } else {
    // Natural / by group: sort within each group
    const ungrouped = enumItems.filter((i) => !i.group && !i.isCommentedOut);
    sortedItems.push(...ungrouped);

    groups.forEach((grp) => {
      const inGrp = enumItems
        .filter((i) => i.group === grp && !i.isCommentedOut)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      sortedItems.push(...inGrp);
    });
  }

  let lastGroup = '';
  sortedItems.forEach((item, idx) => {
    if (item.group && item.group !== lastGroup) {
      if (idx > 0) lines.push('');
      lines.push(`\t(* ${item.group} *)`);
      lastGroup = item.group;
    }

    const isLast = idx === sortedItems.length - 1;
    let itemStr = `\t${item.name}`;

    if (item.value !== undefined && item.value !== '') {
      itemStr += ` := ${item.value}`;
    }

    if (!isLast) {
      itemStr += ',';
    }

    if (item.comment) {
      itemStr += `\t\t(* ${item.comment} *)`;
    }

    lines.push(itemStr);
  });

  const closingType = baseType ? `) ${baseType};` : ');';
  lines.push(closingType);
  lines.push('END_TYPE');

  return lines.join('\n');
}
