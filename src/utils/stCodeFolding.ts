/**
 * Structured Text Code Folding Utility
 * Parses IEC 61131-3 / TwinCAT Structured Text into foldable blocks
 * (CASE statements, case branches, IF/ELSE structures, loops, regions).
 */

export type FoldBlockType =
  | 'case-statement'
  | 'case-branch'
  | 'if-statement'
  | 'for-loop'
  | 'while-loop'
  | 'repeat-loop'
  | 'region'
  | 'comment';

export interface FoldableBlock {
  id: string; // Unique deterministic identifier e.g. "case-stmt-10-85"
  type: FoldBlockType;
  startLine: number; // 1-based start line (header line)
  endLine: number; // 1-based end line (closing line or last line of block)
  label: string; // Header line text, e.g. "CASE machineState OF" or "0: // STATE_INIT"
  summary: string; // Short summary, e.g. "0: STATE_INIT (14 lines)"
  nestingLevel: number;
}

export interface LineMappingEntry {
  viewLineIndex: number; // 0-based index in view lines
  originalLineNumber: number | null; // 1-based line number in fullCode, or null if placeholder
  isPlaceholder?: boolean;
  blockId?: string;
  foldBlock?: FoldableBlock;
  foldableBlockStart?: FoldableBlock; // If this line starts a foldable block
  isFolded?: boolean;
  collapsedCount?: number;
}

export interface FoldedViewModel {
  viewCode: string;
  lineMapping: LineMappingEntry[];
  activeFoldedBlocks: FoldableBlock[];
  totalFoldedLines: number;
}

/**
 * Removes string literals and single-line comments for keyword parsing
 */
function cleanLineForParsing(line: string): string {
  // Strip single-line comments // ...
  let cleaned = line.replace(/\/\/.*$/, '');
  // Strip single-quoted strings '...'
  cleaned = cleaned.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return cleaned;
}

/**
 * Detects all foldable blocks in Structured Text code.
 */
export function detectFoldableBlocks(code: string): FoldableBlock[] {
  if (!code || !code.trim()) return [];

  const lines = code.split('\n');
  const blocks: FoldableBlock[] = [];

  // Stacks for tracking nested structures
  interface StackEntry {
    type: FoldBlockType;
    startLine: number;
    label: string;
    nestingLevel: number;
    caseBranches?: { startLine: number; label: string }[];
    currentBranch?: { startLine: number; label: string } | null;
  }

  const caseStack: StackEntry[] = [];
  const ifStack: StackEntry[] = [];
  const forStack: StackEntry[] = [];
  const whileStack: StackEntry[] = [];
  const repeatStack: StackEntry[] = [];
  const regionStack: StackEntry[] = [];

  let inMultiLineComment = false;
  let commentStartLine = 1;
  let commentHeader = '';

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 1. Multi-line comments (* ... *)
    if (inMultiLineComment) {
      if (rawLine.includes('*)')) {
        inMultiLineComment = false;
        if (lineNum > commentStartLine) {
          blocks.push({
            id: `comment-${commentStartLine}-${lineNum}`,
            type: 'comment',
            startLine: commentStartLine,
            endLine: lineNum,
            label: commentHeader,
            summary: `Comment (${lineNum - commentStartLine + 1} lines)`,
            nestingLevel: 0,
          });
        }
      }
      continue;
    } else if (trimmed.startsWith('(*') && !rawLine.includes('*)')) {
      inMultiLineComment = true;
      commentStartLine = lineNum;
      commentHeader = trimmed.slice(0, 40) + '...';
      continue;
    }

    // Skip empty lines or pure single-line comment lines for block openers
    if (!trimmed || trimmed.startsWith('//')) {
      continue;
    }

    const clean = cleanLineForParsing(rawLine);
    const upperClean = clean.toUpperCase();

    // 2. Pragmas / Regions: {region "..."} ... {endregion}
    if (/\{\s*region\b/i.test(clean) || /\/\/\s*#region\b/i.test(rawLine)) {
      regionStack.push({
        type: 'region',
        startLine: lineNum,
        label: trimmed,
        nestingLevel: regionStack.length,
      });
      continue;
    }
    if (/\{\s*endregion\b/i.test(clean) || /\/\/\s*#endregion\b/i.test(rawLine)) {
      const top = regionStack.pop();
      if (top && lineNum > top.startLine) {
        blocks.push({
          id: `region-${top.startLine}-${lineNum}`,
          type: 'region',
          startLine: top.startLine,
          endLine: lineNum,
          label: top.label,
          summary: `Region (${lineNum - top.startLine + 1} lines)`,
          nestingLevel: top.nestingLevel,
        });
      }
      continue;
    }

    // 3. CASE ... OF statements
    // Match CASE <expr> OF (not END_CASE)
    if (/\bCASE\b/i.test(upperClean) && /\bOF\b/i.test(upperClean) && !/\bEND_CASE\b/i.test(upperClean)) {
      caseStack.push({
        type: 'case-statement',
        startLine: lineNum,
        label: trimmed,
        nestingLevel: caseStack.length,
        currentBranch: null,
      });
      continue;
    }

    // Inside a CASE statement: check for case branches or END_CASE
    if (caseStack.length > 0) {
      const currentCase = caseStack[caseStack.length - 1];

      // Check for END_CASE
      if (/\bEND_CASE\b/i.test(upperClean)) {
        // If there was an open branch, close it before END_CASE
        if (currentCase.currentBranch) {
          const branchStart = currentCase.currentBranch.startLine;
          const branchEnd = lineNum - 1;
          if (branchEnd >= branchStart + 1) {
            blocks.push({
              id: `case-branch-${branchStart}-${branchEnd}`,
              type: 'case-branch',
              startLine: branchStart,
              endLine: branchEnd,
              label: currentCase.currentBranch.label,
              summary: `${currentCase.currentBranch.label.slice(0, 30)} (${branchEnd - branchStart + 1} lines)`,
              nestingLevel: currentCase.nestingLevel + 1,
            });
          }
          currentCase.currentBranch = null;
        }

        // Close CASE statement
        caseStack.pop();
        if (lineNum > currentCase.startLine + 1) {
          blocks.push({
            id: `case-stmt-${currentCase.startLine}-${lineNum}`,
            type: 'case-statement',
            startLine: currentCase.startLine,
            endLine: lineNum,
            label: currentCase.label,
            summary: `CASE (${lineNum - currentCase.startLine + 1} lines)`,
            nestingLevel: currentCase.nestingLevel,
          });
        }
        continue;
      }

      // Check for Case Branch Label: e.g. "0:", "10:", "TABLEMANAGER_INIT:", "10, 20:", "ELSE:"
      // Must end with ':' and NOT ':=' assignment
      const caseLabelMatch = clean.match(/^\s*([A-Za-z0-9_]+(?:\s*,\s*[A-Za-z0-9_]+)*|\d+\s*\.\.\s*\d+|ELSE)\s*:(?!:=)(.*)$/i);
      if (caseLabelMatch) {
        // If previous branch was open, close it at lineNum - 1
        if (currentCase.currentBranch) {
          const branchStart = currentCase.currentBranch.startLine;
          const branchEnd = lineNum - 1;
          if (branchEnd >= branchStart + 1) {
            blocks.push({
              id: `case-branch-${branchStart}-${branchEnd}`,
              type: 'case-branch',
              startLine: branchStart,
              endLine: branchEnd,
              label: currentCase.currentBranch.label,
              summary: `${currentCase.currentBranch.label.slice(0, 30)} (${branchEnd - branchStart + 1} lines)`,
              nestingLevel: currentCase.nestingLevel + 1,
            });
          }
        }

        currentCase.currentBranch = {
          startLine: lineNum,
          label: trimmed,
        };
        // Don't continue, could also be processed
      }
    }

    // 4. IF ... THEN statements
    // Match IF ... THEN (not ELSIF, not END_IF)
    if (/\bIF\b/i.test(upperClean) && /\bTHEN\b/i.test(upperClean) && !/\bEND_IF\b/i.test(upperClean) && !/\bELSIF\b/i.test(upperClean)) {
      ifStack.push({
        type: 'if-statement',
        startLine: lineNum,
        label: trimmed,
        nestingLevel: ifStack.length,
      });
      continue;
    }
    if (/\bEND_IF\b/i.test(upperClean)) {
      const top = ifStack.pop();
      if (top && lineNum > top.startLine) {
        blocks.push({
          id: `if-stmt-${top.startLine}-${lineNum}`,
          type: 'if-statement',
          startLine: top.startLine,
          endLine: lineNum,
          label: top.label,
          summary: `IF (${lineNum - top.startLine + 1} lines)`,
          nestingLevel: top.nestingLevel,
        });
      }
      continue;
    }

    // 5. FOR ... DO loops
    if (/\bFOR\b/i.test(upperClean) && /\bDO\b/i.test(upperClean) && !/\bEND_FOR\b/i.test(upperClean)) {
      forStack.push({
        type: 'for-loop',
        startLine: lineNum,
        label: trimmed,
        nestingLevel: forStack.length,
      });
      continue;
    }
    if (/\bEND_FOR\b/i.test(upperClean)) {
      const top = forStack.pop();
      if (top && lineNum > top.startLine) {
        blocks.push({
          id: `for-loop-${top.startLine}-${lineNum}`,
          type: 'for-loop',
          startLine: top.startLine,
          endLine: lineNum,
          label: top.label,
          summary: `FOR (${lineNum - top.startLine + 1} lines)`,
          nestingLevel: top.nestingLevel,
        });
      }
      continue;
    }

    // 6. WHILE ... DO loops
    if (/\bWHILE\b/i.test(upperClean) && /\bDO\b/i.test(upperClean) && !/\bEND_WHILE\b/i.test(upperClean)) {
      whileStack.push({
        type: 'while-loop',
        startLine: lineNum,
        label: trimmed,
        nestingLevel: whileStack.length,
      });
      continue;
    }
    if (/\bEND_WHILE\b/i.test(upperClean)) {
      const top = whileStack.pop();
      if (top && lineNum > top.startLine) {
        blocks.push({
          id: `while-loop-${top.startLine}-${lineNum}`,
          type: 'while-loop',
          startLine: top.startLine,
          endLine: lineNum,
          label: top.label,
          summary: `WHILE (${lineNum - top.startLine + 1} lines)`,
          nestingLevel: top.nestingLevel,
        });
      }
      continue;
    }

    // 7. REPEAT ... UNTIL loops
    if (/^\s*\bREPEAT\b/i.test(upperClean)) {
      repeatStack.push({
        type: 'repeat-loop',
        startLine: lineNum,
        label: trimmed,
        nestingLevel: repeatStack.length,
      });
      continue;
    }
    if (/\bUNTIL\b/i.test(upperClean)) {
      const top = repeatStack.pop();
      if (top && lineNum > top.startLine) {
        blocks.push({
          id: `repeat-loop-${top.startLine}-${lineNum}`,
          type: 'repeat-loop',
          startLine: top.startLine,
          endLine: lineNum,
          label: top.label,
          summary: `REPEAT (${lineNum - top.startLine + 1} lines)`,
          nestingLevel: top.nestingLevel,
        });
      }
      continue;
    }
  }

  // Handle any remaining open case branches if file ended without END_CASE
  while (caseStack.length > 0) {
    const currentCase = caseStack.pop()!;
    if (currentCase.currentBranch) {
      const branchStart = currentCase.currentBranch.startLine;
      const branchEnd = lines.length;
      if (branchEnd >= branchStart + 1) {
        blocks.push({
          id: `case-branch-${branchStart}-${branchEnd}`,
          type: 'case-branch',
          startLine: branchStart,
          endLine: branchEnd,
          label: currentCase.currentBranch.label,
          summary: `${currentCase.currentBranch.label.slice(0, 30)} (${branchEnd - branchStart + 1} lines)`,
          nestingLevel: currentCase.nestingLevel + 1,
        });
      }
    }
  }

  // Sort blocks by startLine ascending, then by endLine descending
  blocks.sort((a, b) => {
    if (a.startLine !== b.startLine) return a.startLine - b.startLine;
    return b.endLine - a.endLine;
  });

  return blocks;
}

/**
 * Filter out nested folded blocks that fall entirely within an already active outer folded block.
 */
export function getEffectiveFoldedBlocks(
  allBlocks: FoldableBlock[],
  foldedBlockIds: Set<string>
): FoldableBlock[] {
  const active = allBlocks
    .filter((b) => foldedBlockIds.has(b.id))
    .sort((a, b) => {
      if (a.startLine !== b.startLine) return a.startLine - b.startLine;
      return b.endLine - a.endLine;
    });

  const effective: FoldableBlock[] = [];
  let currentEnd = -1;

  for (const block of active) {
    // If this block starts before the end of the previous active block, it's nested inside it!
    if (block.startLine <= currentEnd) {
      continue;
    }
    effective.push(block);
    currentEnd = block.endLine;
  }

  return effective;
}

/**
 * Formats a clean fold placeholder comment for Structured Text with an internal token.
 */
export function createFoldPlaceholder(block: FoldableBlock, lineCount: number, indent: string): string {
  let typeLabel = 'lines';
  if (block.type === 'case-branch') {
    typeLabel = `case branch (${lineCount} lines)`;
  } else if (block.type === 'case-statement') {
    typeLabel = `CASE statement (${lineCount} lines)`;
  } else if (block.type === 'if-statement') {
    typeLabel = `IF structure (${lineCount} lines)`;
  } else if (block.type === 'for-loop') {
    typeLabel = `FOR loop (${lineCount} lines)`;
  } else if (block.type === 'while-loop') {
    typeLabel = `WHILE loop (${lineCount} lines)`;
  } else if (block.type === 'repeat-loop') {
    typeLabel = `REPEAT loop (${lineCount} lines)`;
  }

  return `${indent}(* ⋯ [${typeLabel} folded — click to expand] ⋯ __ST_FOLD:${block.id}__ *)`;
}

/**
 * Strips internal fold token for visual display if needed
 */
export function stripFoldTokenForDisplay(text: string): string {
  return text.replace(/\s*__ST_FOLD:[^_\s]+__/, '');
}

/**
 * Restores fullCode from viewCode by replacing any placeholder lines containing __ST_FOLD:id__
 * with their preserved folded original lines.
 */
export function restoreFullCodeFromViewCode(
  viewCode: string,
  foldedBlocks: FoldableBlock[],
  originalFullCode: string
): string {
  if (!viewCode || foldedBlocks.length === 0) {
    return viewCode;
  }

  const originalLines = originalFullCode.split('\n');
  const viewLines = viewCode.split('\n');

  // Build map of blockId -> folded original lines
  const foldContentMap = new Map<string, string>();
  for (const block of foldedBlocks) {
    let foldStartIdx = block.startLine; // 0-based
    let foldEndIdx = block.endLine - 1; // 0-based

    if (
      block.type === 'case-statement' ||
      block.type === 'if-statement' ||
      block.type === 'for-loop' ||
      block.type === 'while-loop' ||
      block.type === 'repeat-loop'
    ) {
      if (block.endLine - 1 > block.startLine) {
        foldEndIdx = block.endLine - 2;
      }
    }
    const linesSlice = originalLines.slice(foldStartIdx, foldEndIdx + 1);
    foldContentMap.set(block.id, linesSlice.join('\n'));
  }

  // Iterate over view lines and substitute any matched placeholder lines
  const restoredLines: string[] = [];
  for (const line of viewLines) {
    const match = line.match(/__ST_FOLD:([a-zA-Z0-9_-]+)__/);
    if (match && foldContentMap.has(match[1])) {
      const originalBlockContent = foldContentMap.get(match[1])!;
      restoredLines.push(originalBlockContent);
    } else {
      restoredLines.push(line);
    }
  }

  return restoredLines.join('\n');
}

/**
 * Returns all case branch block IDs (e.g. for "Fold Cases")
 */
export function getAllCaseBranchBlockIds(blocks: FoldableBlock[]): string[] {
  return blocks.filter((b) => b.type === 'case-branch').map((b) => b.id);
}

/**
 * Returns all IF statement block IDs (e.g. for "Fold IFs")
 */
export function getAllIfBlockIds(blocks: FoldableBlock[]): string[] {
  return blocks.filter((b) => b.type === 'if-statement').map((b) => b.id);
}

/**
 * Returns all foldable block IDs
 */
export function getAllFoldableBlockIds(blocks: FoldableBlock[]): string[] {
  return blocks.map((b) => b.id);
}

/**
 * Builds the folded view model: calculates visible lines, maps them back to original lines,
 * and generates the display code string.
 */
export function buildFoldedViewModel(
  fullCode: string,
  allBlocks: FoldableBlock[],
  foldedBlockIds: Set<string>
): FoldedViewModel {
  if (!fullCode) {
    return {
      viewCode: '',
      lineMapping: [],
      activeFoldedBlocks: [],
      totalFoldedLines: 0,
    };
  }

  const effectiveBlocks = getEffectiveFoldedBlocks(allBlocks, foldedBlockIds);
  const blocksByStartLine = new Map<number, FoldableBlock>();
  for (const b of allBlocks) {
    // If multiple blocks start on same line, prefer the most specific one or first one
    if (!blocksByStartLine.has(b.startLine)) {
      blocksByStartLine.set(b.startLine, b);
    }
  }

  if (effectiveBlocks.length === 0) {
    // No folds active
    const rawLines = fullCode.split('\n');
    const mapping: LineMappingEntry[] = rawLines.map((_, idx) => {
      const lineNum = idx + 1;
      const foldBlock = blocksByStartLine.get(lineNum);
      return {
        viewLineIndex: idx,
        originalLineNumber: lineNum,
        foldableBlockStart: foldBlock,
        isFolded: false,
      };
    });

    return {
      viewCode: fullCode,
      lineMapping: mapping,
      activeFoldedBlocks: [],
      totalFoldedLines: 0,
    };
  }

  const originalLines = fullCode.split('\n');
  const viewLines: string[] = [];
  const lineMapping: LineMappingEntry[] = [];
  let totalFoldedLines = 0;

  // Track active folded blocks by their start line
  const activeByStart = new Map<number, FoldableBlock>();
  for (const eb of effectiveBlocks) {
    activeByStart.set(eb.startLine, eb);
  }

  let lineIdx = 0; // 0-based index into originalLines
  while (lineIdx < originalLines.length) {
    const currentLineNum = lineIdx + 1;
    const rawLine = originalLines[lineIdx];
    const activeFold = activeByStart.get(currentLineNum);

    if (!activeFold) {
      // Normal unfolded line
      const foldBlock = blocksByStartLine.get(currentLineNum);
      lineMapping.push({
        viewLineIndex: viewLines.length,
        originalLineNumber: currentLineNum,
        foldableBlockStart: foldBlock,
        isFolded: false,
      });
      viewLines.push(rawLine);
      lineIdx++;
    } else {
      // This line starts an active folded block!
      // Header line remains visible
      lineMapping.push({
        viewLineIndex: viewLines.length,
        originalLineNumber: currentLineNum,
        foldableBlockStart: activeFold,
        isFolded: true,
      });
      viewLines.push(rawLine);

      // Determine lines to collapse:
      // For case-statement, if-statement, loops: we collapse lines between startLine+1 and endLine-1
      // (keeping the closing keyword visible), OR for case-branch: collapse lines from startLine+1 through endLine
      let foldStartIdx = lineIdx + 1;
      let foldEndIdx = activeFold.endLine - 1; // 0-based inclusive index of the last folded line
      let keepClosingLine = false;

      if (
        activeFold.type === 'case-statement' ||
        activeFold.type === 'if-statement' ||
        activeFold.type === 'for-loop' ||
        activeFold.type === 'while-loop' ||
        activeFold.type === 'repeat-loop'
      ) {
        // Keep the closing keyword line (e.g. END_CASE, END_IF) visible
        if (activeFold.endLine - 1 > activeFold.startLine) {
          foldEndIdx = activeFold.endLine - 2; // don't fold closing line
          keepClosingLine = true;
        } else {
          foldEndIdx = activeFold.endLine - 1;
          keepClosingLine = false;
        }
      } else {
        // For case-branch or comments, fold all lines through endLine
        foldEndIdx = activeFold.endLine - 1;
        keepClosingLine = false;
      }

      const foldedCount = Math.max(0, foldEndIdx - foldStartIdx + 1);
      totalFoldedLines += foldedCount;

      if (foldedCount > 0) {
        // Get indentation of the header line
        const indentMatch = rawLine.match(/^(\s*)/);
        const indent = (indentMatch ? indentMatch[1] : '') + '    ';
        const placeholderText = createFoldPlaceholder(activeFold, foldedCount, indent);

        // Insert placeholder line in view
        lineMapping.push({
          viewLineIndex: viewLines.length,
          originalLineNumber: null, // placeholder has no 1:1 original line
          isPlaceholder: true,
          blockId: activeFold.id,
          foldBlock: activeFold,
          isFolded: true,
          collapsedCount: foldedCount,
        });
        viewLines.push(placeholderText);
      }

      // Fast forward past the folded lines
      lineIdx = foldEndIdx + 1;

      // If we are keeping closing line, it will be handled on next loop iteration (since lineIdx points to it)
    }
  }

  return {
    viewCode: viewLines.join('\n'),
    lineMapping,
    activeFoldedBlocks: effectiveBlocks,
    totalFoldedLines,
  };
}

/**
 * Finds the corresponding block for a given state ID inside a method.
 */
export function findFoldableBlockForState(
  blocks: FoldableBlock[],
  stateId: string
): FoldableBlock | undefined {
  if (!stateId) return undefined;
  const target = stateId.trim().toUpperCase();

  // Look for case branch matching stateId
  return blocks.find((b) => {
    if (b.type !== 'case-branch') return false;
    const cleanLabel = b.label.toUpperCase();
    return cleanLabel.includes(target);
  });
}
