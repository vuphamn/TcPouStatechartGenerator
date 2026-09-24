/**
 * Utility for parsing, extracting, and updating Structured Text code
 * for individual state branches inside the doState() method of a Beckhoff TwinCAT .TcPOU file.
 */

export interface ExtractedStateCode {
  success: boolean;
  stateId: string;
  stateVarName: string;
  caseLabelLine: string;
  code: string;
  hasCaseBranch: boolean;
  doStateFound: boolean;
  detectedTransitions: string[];
  error?: string;
}

export interface UpdateStateCodeResult {
  success: boolean;
  updatedPou: string;
  action?: 'updated' | 'inserted';
  detectedTransitions?: string[];
  error?: string;
}

/**
 * Extracts transitions (e.g. `machineState := NEXT_STATE;`) from a block of Structured Text.
 */
export function parseTransitionsFromStateCode(code: string, stateVarName: string = 'machineState'): string[] {
  const transitions: string[] = [];
  const escapedVar = stateVarName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match assignment to state variable: <stateVar> := <NEXT_STATE>;
  const rx = new RegExp(`\\b${escapedVar}\\s*:=\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*;`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = rx.exec(code)) !== null) {
    const targetState = match[1];
    if (!transitions.includes(targetState)) {
      transitions.push(targetState);
    }
  }
  return transitions;
}

/**
 * Extracts the Structured Text code for a specific state/node from the doState() method in a .TcPOU file.
 */
export function getStateCodeFromPou(pouXml: string, targetState: string): ExtractedStateCode {
  if (!pouXml || !pouXml.trim()) {
    return {
      success: false,
      stateId: targetState,
      stateVarName: 'machineState',
      caseLabelLine: `${targetState}:`,
      code: '',
      hasCaseBranch: false,
      doStateFound: false,
      detectedTransitions: [],
      error: 'Empty or missing .TcPOU content.',
    };
  }

  // 1. Locate the doState method
  const methodRx = /<Method[^>]*\bName=["']doState["'][^>]*>([\s\S]*?)<\/Method>/i;
  const methodMatch = pouXml.match(methodRx);
  if (!methodMatch) {
    return {
      success: false,
      stateId: targetState,
      stateVarName: 'machineState',
      caseLabelLine: `${targetState}:`,
      code: '',
      hasCaseBranch: false,
      doStateFound: false,
      detectedTransitions: [],
      error: "Method 'doState' was not found in this .TcPOU file.",
    };
  }

  const methodInner = methodMatch[1];

  // 2. Extract ST block
  const stRx = /<ST[^>]*>([\s\S]*?)<\/ST>/i;
  const stMatch = methodInner.match(stRx);
  if (!stMatch) {
    return {
      success: false,
      stateId: targetState,
      stateVarName: 'machineState',
      caseLabelLine: `${targetState}:`,
      code: '',
      hasCaseBranch: false,
      doStateFound: true,
      detectedTransitions: [],
      error: '<ST> implementation block not found in doState() method.',
    };
  }

  let stCode = stMatch[1];
  const cdataMatch = stCode.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  if (cdataMatch) {
    stCode = cdataMatch[1];
  } else {
    // Unescape XML entities if not in CDATA
    stCode = stCode
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  // 3. Match CASE statement
  const caseRx = /(\bCASE\b\s*\(?\s*([A-Za-z0-9_\.]+)\s*\)?\s*\bOF\b)([\s\S]*?)(\bEND_CASE\b;?)/i;
  const caseMatch = stCode.match(caseRx);
  if (!caseMatch) {
    return {
      success: false,
      stateId: targetState,
      stateVarName: 'machineState',
      caseLabelLine: `${targetState}:`,
      code: '',
      hasCaseBranch: false,
      doStateFound: true,
      detectedTransitions: [],
      error: 'CASE statement was not found in doState() Structured Text.',
    };
  }

  const stateVar = caseMatch[2].trim();
  const body = caseMatch[3];

  // 4. Find all case branch labels
  // Matches lines like "  TABLEMANAGER_DISABLED:" or "STATE_A, STATE_B:"
  // Ignores assignments with :=
  const labelPattern = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*:(?!\=)(?:\s*(?:\/\/[^\n]*|\(\*[\s\S]*?\*\)))?\s*$/gm;
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = labelPattern.exec(body)) !== null) {
    matches.push(m);
  }

  for (let i = 0; i < matches.length; i++) {
    const curMatch = matches[i];
    const labels = curMatch[1].split(',').map((l) => l.trim());
    if (labels.includes(targetState)) {
      const startIdx = curMatch.index + curMatch[0].length;
      let endIdx = i + 1 < matches.length ? matches[i + 1].index : body.length;

      // Check if an ELSE branch exists between startIdx and endIdx
      const slice = body.slice(startIdx, endIdx);
      const elseMatch = slice.match(/^[ \t]*ELSE\b/im);
      if (elseMatch && elseMatch.index !== undefined) {
        endIdx = startIdx + elseMatch.index;
      }

      let rawCode = body.slice(startIdx, endIdx);
      // Clean up common indentation
      rawCode = normalizeIndentation(rawCode);

      const transitions = parseTransitionsFromStateCode(rawCode, stateVar);

      return {
        success: true,
        stateId: targetState,
        stateVarName: stateVar,
        caseLabelLine: curMatch[0].trim(),
        code: rawCode,
        hasCaseBranch: true,
        doStateFound: true,
        detectedTransitions: transitions,
      };
    }
  }

  // Not found in CASE branches
  return {
    success: true, // Not a failure; simply has no case branch yet
    stateId: targetState,
    stateVarName: stateVar,
    caseLabelLine: `${targetState}:`,
    code: '',
    hasCaseBranch: false,
    doStateFound: true,
    detectedTransitions: [],
  };
}

/**
 * Normalizes leading tabs/spaces in extracted ST code so it begins cleanly in the editor.
 */
function normalizeIndentation(code: string): string {
  // Remove leading empty lines
  const lines = code.split(/\r?\n/);
  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }
  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  if (lines.length === 0) return '';

  // Find minimum leading indentation (tabs or spaces) across non-empty lines
  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^(\t+| +)/);
    const indentLen = match ? match[0].length : 0;
    if (indentLen < minIndent) {
      minIndent = indentLen;
    }
  }

  if (minIndent > 0 && minIndent !== Infinity) {
    return lines
      .map((line) => {
        if (!line.trim()) return '';
        return line.slice(minIndent);
      })
      .join('\n');
  }

  return lines.join('\n');
}

/**
 * Updates or inserts the Structured Text code for a state inside the doState() method of a .TcPOU file.
 * Returns the entire updated .TcPOU XML string.
 */
export function updateStateCodeInPou(
  pouXml: string,
  targetState: string,
  newCode: string
): UpdateStateCodeResult {
  if (!pouXml || !pouXml.trim()) {
    return { success: false, updatedPou: pouXml, error: 'Empty .TcPOU content' };
  }

  // 1. Locate doState method
  const methodRx = /(<Method[^>]*\bName=["']doState["'][^>]*>)([\s\S]*?)(<\/Method>)/i;
  const methodMatch = pouXml.match(methodRx);
  if (!methodMatch || methodMatch.index === undefined) {
    return { success: false, updatedPou: pouXml, error: "Method 'doState' not found in .TcPOU file." };
  }

  const methodPrefix = methodMatch[1];
  const methodInner = methodMatch[2];
  const methodSuffix = methodMatch[3];

  // 2. Locate <ST> block inside doState
  const stRx = /(<ST[^>]*>)([\s\S]*?)(<\/ST>)/i;
  const stMatch = methodInner.match(stRx);
  if (!stMatch || stMatch.index === undefined) {
    return { success: false, updatedPou: pouXml, error: '<ST> block not found in doState() implementation.' };
  }

  const stPrefix = stMatch[1];
  const stContent = stMatch[2];
  const stSuffix = stMatch[3];

  const cdataMatch = stContent.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  const isCdata = Boolean(cdataMatch);
  const stCode = cdataMatch ? cdataMatch[1] : stContent;

  // 3. Locate CASE statement inside stCode
  const caseRx = /(\bCASE\b\s*\(?\s*([A-Za-z0-9_\.]+)\s*\)?\s*\bOF\b)([\s\S]*?)(\bEND_CASE\b;?)/i;
  const caseMatch = stCode.match(caseRx);
  if (!caseMatch || caseMatch.index === undefined) {
    return { success: false, updatedPou: pouXml, error: 'CASE statement not found in doState() Structured Text.' };
  }

  const caseHeader = caseMatch[1];
  const stateVarName = caseMatch[2].trim();
  const caseBody = caseMatch[3];
  const caseFooter = caseMatch[4];

  // 4. Find all case labels in caseBody
  const labelPattern = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*:(?!\=)(?:\s*(?:\/\/[^\n]*|\(\*[\s\S]*?\*\)))?\s*$/gm;
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = labelPattern.exec(caseBody)) !== null) {
    matches.push(m);
  }

  // Prepare cleaned newCode: if user accidentally typed or pasted the state label at top, strip it
  let cleanedCode = newCode.trim();
  const labelStripRx = new RegExp(`^[ \\t]*${targetState.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*:(?!\\=)[^\\n]*\\n?`, 'i');
  cleanedCode = cleanedCode.replace(labelStripRx, '').trim();

  // Format newCode lines with TwinCAT standard double-tab indentation
  let formattedCode = '\n';
  if (cleanedCode) {
    const lines = cleanedCode.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) {
        formattedCode += `\t\t${line}\n`;
      } else {
        formattedCode += '\n';
      }
    }
  } else {
    // Empty body with placeholder comment
    formattedCode += `\t\t(* State: ${targetState} *)\n`;
  }
  formattedCode += '\n\t';

  let newCaseBody: string;
  let action: 'updated' | 'inserted' = 'updated';

  // Check if targetState exists in matches
  let foundMatchIndex = -1;
  for (let i = 0; i < matches.length; i++) {
    const labels = matches[i][1].split(',').map((l) => l.trim());
    if (labels.includes(targetState)) {
      foundMatchIndex = i;
      break;
    }
  }

  if (foundMatchIndex >= 0) {
    const curMatch = matches[foundMatchIndex];
    const startIdx = curMatch.index + curMatch[0].length;
    let endIdx = foundMatchIndex + 1 < matches.length ? matches[foundMatchIndex + 1].index : caseBody.length;

    // Check if ELSE is between startIdx and endIdx
    const slice = caseBody.slice(startIdx, endIdx);
    const elseMatch = slice.match(/^[ \t]*ELSE\b/im);
    if (elseMatch && elseMatch.index !== undefined) {
      endIdx = startIdx + elseMatch.index;
    }

    newCaseBody = caseBody.slice(0, startIdx) + formattedCode + caseBody.slice(endIdx);
    action = 'updated';
  } else {
    // State branch doesn't exist yet -> insert before ELSE or before end of CASE
    const elseMatch = caseBody.match(/^[ \t]*ELSE\b/im);
    const insertIdx = elseMatch && elseMatch.index !== undefined ? elseMatch.index : caseBody.length;

    const newBranch = `\n\t${targetState}:${formattedCode}`;
    newCaseBody = caseBody.slice(0, insertIdx) + newBranch + caseBody.slice(insertIdx);
    action = 'inserted';
  }

  // Reassemble stCode
  const newStCode =
    stCode.slice(0, caseMatch.index + caseHeader.length) +
    newCaseBody +
    stCode.slice(caseMatch.index + caseHeader.length + caseBody.length);

  // Wrap back into CDATA if needed
  const newStContent = isCdata ? `<![CDATA[${newStCode}]]>` : newStCode;

  // Reassemble methodInner
  const newMethodInner =
    methodInner.slice(0, stMatch.index + stPrefix.length) +
    newStContent +
    methodInner.slice(stMatch.index + stPrefix.length + stContent.length);

  // Reassemble pouXml
  const updatedPou =
    pouXml.slice(0, methodMatch.index + methodPrefix.length) +
    newMethodInner +
    pouXml.slice(methodMatch.index + methodPrefix.length + methodInner.length);

  const detectedTransitions = parseTransitionsFromStateCode(cleanedCode, stateVarName);

  return {
    success: true,
    updatedPou,
    action,
    detectedTransitions,
  };
}

export interface ExtractedPreProcessCode {
  success: boolean;
  code: string;
  declaration: string;
  methodFound: boolean;
  stateVarName: string;
  detectedTransitions: string[];
  error?: string;
}

export interface ExtractedMethodCode {
  success: boolean;
  methodName: string;
  code: string;
  declaration: string;
  methodFound: boolean;
  stateVarName: string;
  detectedTransitions: string[];
  error?: string;
}

export interface UpdatePreProcessCodeResult {
  success: boolean;
  updatedPou: string;
  action?: 'updated' | 'inserted';
  detectedTransitions?: string[];
  error?: string;
}

export interface UpdateMethodCodeResult {
  success: boolean;
  methodName: string;
  updatedPou: string;
  action?: 'updated' | 'inserted';
  detectedTransitions?: string[];
  error?: string;
}

/**
 * Extracts all method names declared in a .TcPOU XML file and returns them sorted in ascending order.
 */
export function getAllMethodsFromPou(pouXml: string): string[] {
  if (!pouXml || !pouXml.trim()) {
    return ['doState'];
  }

  const methodRx = /<Method[^>]*\bName=["']([^"']+)["'][^>]*>/gi;
  const methodsSet = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = methodRx.exec(pouXml)) !== null) {
    if (match[1] && match[1].trim()) {
      methodsSet.add(match[1].trim());
    }
  }

  const methods = Array.from(methodsSet);
  // Sort in ascending alphabetical order
  methods.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  if (methods.length === 0) {
    return ['doState'];
  }

  return methods;
}

/**
 * Extracts the Structured Text implementation and declaration of any method from a .TcPOU file.
 */
export function getMethodCodeFromPou(pouXml: string, methodName: string): ExtractedMethodCode {
  const cleanName = (methodName || 'doState').replace(/\(\)$/, '').trim();

  if (!pouXml || !pouXml.trim()) {
    return {
      success: false,
      methodName: cleanName,
      code: '',
      declaration: '',
      methodFound: false,
      stateVarName: 'machineState',
      detectedTransitions: [],
      error: 'Empty or missing .TcPOU content.',
    };
  }

  // Detect state variable name if possible (e.g. from doState or Declaration)
  let stateVarName = 'machineState';
  const caseRx = /\bCASE\b\s*\(?\s*([A-Za-z0-9_\.]+)\s*\)?\s*\bOF\b/i;
  const caseMatch = pouXml.match(caseRx);
  if (caseMatch) {
    stateVarName = caseMatch[1].trim();
  }

  // Escape special regex characters in cleanName
  const escapedName = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const methodRx = new RegExp(`<Method[^>]*\\bName=["']${escapedName}["'][^>]*>([\\s\\S]*?)<\\/Method>`, 'i');
  const methodMatch = pouXml.match(methodRx);

  if (!methodMatch) {
    return {
      success: true, // not an error, method can be added
      methodName: cleanName,
      code: '',
      declaration: `METHOD ${cleanName}\nVAR_INPUT\nEND_VAR`,
      methodFound: false,
      stateVarName,
      detectedTransitions: [],
      error: `Method '${cleanName}' is not present in this .TcPOU file. You can create it here and click Save to insert it.`,
    };
  }

  const methodInner = methodMatch[1];

  // Extract Declaration
  let declaration = '';
  const declRx = /<Declaration[^>]*>([\s\S]*?)<\/Declaration>/i;
  const declMatch = methodInner.match(declRx);
  if (declMatch) {
    const rawDecl = declMatch[1];
    const cdataMatch = rawDecl.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
    declaration = cdataMatch ? cdataMatch[1] : rawDecl;
  }

  // Extract ST block
  const stRx = /<ST[^>]*>([\s\S]*?)<\/ST>/i;
  const stMatch = methodInner.match(stRx);
  let stCode = '';
  if (stMatch) {
    const rawSt = stMatch[1];
    const cdataMatch = rawSt.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
    if (cdataMatch) {
      stCode = cdataMatch[1];
    } else {
      stCode = rawSt
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    }
  }

  const detectedTransitions = parseTransitionsFromStateCode(stCode, stateVarName);

  return {
    success: true,
    methodName: cleanName,
    code: stCode,
    declaration,
    methodFound: true,
    stateVarName,
    detectedTransitions,
  };
}

/**
 * Updates or creates the Structured Text code and declaration for any method inside a .TcPOU file.
 */
export function updateMethodCodeInPou(
  pouXml: string,
  methodName: string,
  newCode: string,
  newDeclaration?: string
): UpdateMethodCodeResult {
  const cleanName = (methodName || 'doState').replace(/\(\)$/, '').trim();

  if (!pouXml || !pouXml.trim()) {
    return { success: false, methodName: cleanName, updatedPou: pouXml, error: 'Empty .TcPOU content' };
  }

  // Detect state variable name
  let stateVarName = 'machineState';
  const caseRx = /\bCASE\b\s*\(?\s*([A-Za-z0-9_\.]+)\s*\)?\s*\bOF\b/i;
  const caseMatch = pouXml.match(caseRx);
  if (caseMatch) {
    stateVarName = caseMatch[1].trim();
  }

  const escapedName = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const methodRx = new RegExp(`(<Method[^>]*\\bName=["']${escapedName}["'][^>]*>)([\\s\\S]*?)(<\\/Method>)`, 'i');
  const methodMatch = pouXml.match(methodRx);

  // If method doesn't exist, insert before </POU> or before doState
  if (!methodMatch || methodMatch.index === undefined) {
    const declText =
      newDeclaration && newDeclaration.trim()
        ? newDeclaration.trim()
        : `METHOD ${cleanName}\nVAR_INPUT\nEND_VAR`;

    const newMethodXml = `\n    <Method Name="${cleanName}">\n      <Declaration><![CDATA[${declText}]]></Declaration>\n      <Implementation>\n        <ST><![CDATA[${newCode}]]></ST>\n      </Implementation>\n    </Method>\n`;

    const pouEndIdx = pouXml.search(/<\/POU>/i);
    let updatedPou: string;
    if (pouEndIdx !== -1) {
      updatedPou = pouXml.slice(0, pouEndIdx) + newMethodXml + pouXml.slice(pouEndIdx);
    } else {
      updatedPou = pouXml + newMethodXml;
    }

    const detectedTransitions = parseTransitionsFromStateCode(newCode, stateVarName);
    return {
      success: true,
      methodName: cleanName,
      updatedPou,
      action: 'inserted',
      detectedTransitions,
    };
  }

  const methodPrefix = methodMatch[1];
  let methodInner = methodMatch[2];
  const methodSuffix = methodMatch[3];

  // Update Declaration if newDeclaration is provided
  if (newDeclaration !== undefined) {
    const declRx = /(<Declaration[^>]*>)([\s\S]*?)(<\/Declaration>)/i;
    const declMatch = methodInner.match(declRx);
    if (declMatch && declMatch.index !== undefined) {
      const formattedDecl = `<![CDATA[${newDeclaration}]]>`;
      methodInner =
        methodInner.slice(0, declMatch.index + declMatch[1].length) +
        formattedDecl +
        methodInner.slice(declMatch.index + declMatch[1].length + declMatch[2].length);
    } else {
      // Insert declaration before <Implementation>
      const implIdx = methodInner.search(/<Implementation[^>]*>/i);
      const declBlock = `\n      <Declaration><![CDATA[${newDeclaration}]]></Declaration>`;
      if (implIdx !== -1) {
        methodInner = methodInner.slice(0, implIdx) + declBlock + '\n      ' + methodInner.slice(implIdx);
      } else {
        methodInner = declBlock + methodInner;
      }
    }
  }

  // Locate <ST> block inside method
  const stRx = /(<ST[^>]*>)([\s\S]*?)(<\/ST>)/i;
  const stMatch = methodInner.match(stRx);
  if (!stMatch || stMatch.index === undefined) {
    // If no <ST> block, create one inside <Implementation>
    const implRx = /(<Implementation[^>]*>)([\s\S]*?)(<\/Implementation>)/i;
    const implMatch = methodInner.match(implRx);
    if (implMatch && implMatch.index !== undefined) {
      const newImpl = `${implMatch[1]}\n        <ST><![CDATA[${newCode}]]></ST>\n      ${implMatch[3]}`;
      methodInner =
        methodInner.slice(0, implMatch.index) +
        newImpl +
        methodInner.slice(implMatch.index + implMatch[0].length);
    } else {
      methodInner = `${methodInner}\n      <Implementation>\n        <ST><![CDATA[${newCode}]]></ST>\n      </Implementation>`;
    }
  } else {
    const stPrefix = stMatch[1];
    const newStContent = `<![CDATA[${newCode}]]>`;

    methodInner =
      methodInner.slice(0, stMatch.index + stPrefix.length) +
      newStContent +
      methodInner.slice(stMatch.index + stPrefix.length + stMatch[2].length);
  }

  // Reassemble pouXml
  const updatedPou =
    pouXml.slice(0, methodMatch.index + methodPrefix.length) +
    methodInner +
    pouXml.slice(methodMatch.index + methodPrefix.length + methodMatch[2].length);

  const detectedTransitions = parseTransitionsFromStateCode(newCode, stateVarName);

  return {
    success: true,
    methodName: cleanName,
    updatedPou,
    action: 'updated',
    detectedTransitions,
  };
}

/**
 * Extracts the Structured Text implementation and declaration of preProcess() from a .TcPOU file.
 */
export function getPreProcessCodeFromPou(pouXml: string): ExtractedPreProcessCode {
  return getMethodCodeFromPou(pouXml, 'preProcess');
}

/**
 * Updates or creates the Structured Text code for preProcess() inside a .TcPOU file.
 */
export function updatePreProcessCodeInPou(
  pouXml: string,
  newCode: string,
  newDeclaration?: string
): UpdatePreProcessCodeResult {
  return updateMethodCodeInPou(pouXml, 'preProcess', newCode, newDeclaration);
}
