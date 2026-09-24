import { DiagramNotes, EdgeInfo } from '../types.ts';
import { cleanNodeId } from './nodeDragger.ts';

/**
 * Escapes characters that could break Mermaid syntax.
 */
export function sanitizeNoteForMermaid(note: string): string {
  if (!note) return '';
  return note
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/"/g, "'")
    .trim();
}

/**
 * Normalizes an edge identifier from source and target state IDs.
 */
export function getEdgeKey(from: string, to: string): string {
  return `${from.trim()}->${to.trim()}`;
}

/**
 * Robustly parses any edge key (canonical "from->to", with index "from->to#1",
 * or DOM id "L-from-to-0", "mermaid-123-L_from_to_0", "flowchart-from-to-0", "edge-from-to") into from, to, and optional index.
 */
export function parseEdgeKey(
  edgeKey: string,
  availableEdges?: EdgeInfo[]
): { from: string; to: string; index?: number; edge?: EdgeInfo } | null {
  if (!edgeKey) return null;

  // 1. Direct match with availableEdges by id, pathId, or canonical key
  if (availableEdges && availableEdges.length > 0) {
    const direct = availableEdges.find(
      (e) =>
        e.id === edgeKey ||
        (e.pathId && e.pathId === edgeKey) ||
        `${e.from}->${e.to}` === edgeKey
    );
    if (direct) {
      return { from: direct.from, to: direct.to, edge: direct };
    }
  }

  // 2. Canonical "from->to" or "from->to#1"
  if (edgeKey.includes('->')) {
    const [rawFrom, rest] = edgeKey.split('->');
    const [rawTo, rawIndex] = (rest || '').split('#');
    const from = (rawFrom || '').trim();
    const to = (rawTo || '').trim();
    const idx = rawIndex ? parseInt(rawIndex, 10) : undefined;
    if (from && to) {
      const match = availableEdges?.find(
        (e) =>
          (e.from === from || cleanNodeId(e.from) === cleanNodeId(from)) &&
          (e.to === to || cleanNodeId(e.to) === cleanNodeId(to))
      );
      return {
        from: match?.from || from,
        to: match?.to || to,
        index: isNaN(idx!) ? undefined : idx,
        edge: match,
      };
    }
  }

  // 3. Match against availableEdges by checking if edgeKey contains from & to patterns
  if (availableEdges && availableEdges.length > 0) {
    for (const e of availableEdges) {
      const cf = cleanNodeId(e.from);
      const ct = cleanNodeId(e.to);
      const patterns = [
        `L_${e.from}_${e.to}`,
        `L-${e.from}-${e.to}`,
        `_${e.from}_${e.to}_`,
        `-${e.from}-${e.to}-`,
        `_${cf}_${ct}_`,
        `-${cf}-${ct}-`,
        `L_${cf}_${ct}`,
        `L-${cf}-${ct}`,
      ];
      if (patterns.some((p) => edgeKey.includes(p))) {
        return { from: e.from, to: e.to, edge: e };
      }
    }
  }

  // 4. Strip SVG container and renderer prefixes (e.g., "mermaid-123-L_", "testelk-L_", "flowchart-", "L-", "L_")
  const stripped = edgeKey
    .replace(/^.*?[_-]L[_-]/, '')
    .replace(/^(?:flowchart|edge)[_-]/, '')
    .replace(/^L[_-]/, '');

  // Try matching stripped string against availableEdges
  if (availableEdges && availableEdges.length > 0) {
    for (const e of availableEdges) {
      const cf = cleanNodeId(e.from);
      const ct = cleanNodeId(e.to);
      if (
        (stripped.startsWith(e.from) || stripped.startsWith(cf)) &&
        (stripped.includes(e.to) || stripped.includes(ct))
      ) {
        return { from: e.from, to: e.to, edge: e };
      }
    }
  }

  // 5. Fallback regex: "From_To_0" or "From-To-0" or "From_To" or "From-To"
  const m = stripped.match(/^([A-Za-z0-9_.]+?)[_-]([A-Za-z0-9_.]+?)(?:[_-](\d+))?$/);
  if (m) {
    const from = m[1].trim();
    const to = m[2].trim();
    const idx = m[3] ? parseInt(m[3], 10) : undefined;
    const match = availableEdges?.find(
      (e) =>
        (e.from === from || cleanNodeId(e.from) === cleanNodeId(from)) &&
        (e.to === to || cleanNodeId(e.to) === cleanNodeId(to))
    );
    return {
      from: match?.from || from,
      to: match?.to || to,
      index: isNaN(idx!) ? undefined : idx,
      edge: match,
    };
  }

  return null;
}

export function extractPriorityFromText(text: string): { priority: number; symbol: string } | null {
  if (!text) return null;
  // Check (1) or (2)...
  const mParen = text.match(/(?:^|\s)\((\d+)\)/);
  if (mParen) {
    return { priority: parseInt(mParen[1], 10), symbol: `(${mParen[1]})` };
  }
  // Check [1] or [2]...
  const mBracket = text.match(/(?:^|\s)\[(\d+)\]/);
  if (mBracket) {
    return { priority: parseInt(mBracket[1], 10), symbol: `[${mBracket[1]}]` };
  }
  // Check Unicode circled numbers ①..⑳ (0x2460..0x2473)
  for (let i = 1; i <= 20; i++) {
    const sym = String.fromCodePoint(0x2460 + i - 1);
    if (text.includes(sym)) return { priority: i, symbol: sym };
  }
  // Check ㉑..㉟ (0x3251..0x325f)
  for (let i = 21; i <= 35; i++) {
    const sym = String.fromCodePoint(0x3251 + i - 21);
    if (text.includes(sym)) return { priority: i, symbol: sym };
  }
  // Check ㊱..㊿ (0x32b1..0x32bf)
  for (let i = 36; i <= 50; i++) {
    const sym = String.fromCodePoint(0x32b1 + i - 36);
    if (text.includes(sym)) return { priority: i, symbol: sym };
  }
  const m = text.match(/\[priority:\s*(\d+)\]/i);
  if (m) {
    return { priority: parseInt(m[1], 10), symbol: m[0] };
  }
  return null;
}

export function extractCleanCondition(rawLabel?: string): string {
  if (!rawLabel) return '';
  const prio = extractPriorityFromText(rawLabel);
  let clean = rawLabel
    // Only strip note annotations (which start with 📝 or [📝...]), not normal multi-line <br/> tags!
    .replace(/<br\s*\/?>\s*📝.*$/s, '')
    .replace(/\[📝[^\]]*\]/g, '')
    .trim();
  if (prio) {
    clean = clean.replace(prio.symbol, '').trim();
  }
  // Decode HTML entity for hash if present
  clean = clean.replace(/#35;/g, '#');
  // Remove wrapping quotes if any
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    clean = clean.slice(1, -1).trim();
  }
  return clean;
}

/**
 * Extracts all transitions/edges from Mermaid source code (both stateDiagram-v2 and flowchart).
 */
export function extractEdgesFromMermaid(code: string, notes?: DiagramNotes): EdgeInfo[] {
  const edges: EdgeInfo[] = [];
  const seenIds = new Set<string>();
  const isFlowchart = code.includes('flowchart') || code.includes('graph');

  if (isFlowchart) {
    // Match all flowchart transitions in document order:
    // A -->|Label| B or A -->|"Label"| B or A --> B or A -.->|Label| B or A ==> B
    const fcPattern = /^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\]|\({1,2}[^)]*\){1,2}|\{[^}]*\})*\s*(?:-->|-.->|==>|---|--)\s*(?:\|"?([\s\S]*?)"?\|\s*)?([A-Za-z0-9_.-]+)(?:\[[^\]]*\]|\({1,2}[^)]*\){1,2}|\{[^}]*\})*/gm;
    let m: RegExpExecArray | null;
    while ((m = fcPattern.exec(code)) !== null) {
      const from = m[1].trim();
      const label = m[2]?.trim();
      const to = m[3].trim();
      if (from === 'startNode' || to === 'startNode') continue;
      const baseKey = getEdgeKey(from, to);
      let id = baseKey;
      if (seenIds.has(id)) {
        id = `${baseKey}#${edges.length}`;
      }
      seenIds.add(id);
      const note =
        notes?.edges[id] ||
        notes?.edges[baseKey] ||
        (notes?.edges
          ? Object.entries(notes.edges).find(
              ([k]) =>
                (k.includes(from) && k.includes(to)) ||
                (k.includes(cleanNodeId(from)) && k.includes(cleanNodeId(to)))
            )?.[1]
          : undefined);
      const prio = label ? extractPriorityFromText(label) : null;
      const condition = label ? extractCleanCondition(label) : undefined;
      edges.push({
        id,
        from,
        to,
        label,
        hasNote: Boolean(note),
        note,
        priority: prio ? prio.priority : undefined,
        condition,
      });
    }
  } else {
    // stateDiagram-v2 transitions:
    // From --> To: Label
    // From --> To
    const sdPattern = /^\s*([A-Za-z0-9_.-]+|\[\*\])\s*-->\s*([A-Za-z0-9_.-]+|\[\*\])(?:\s*:\s*([^\n]+))?/gm;
    let m: RegExpExecArray | null;
    while ((m = sdPattern.exec(code)) !== null) {
      const from = m[1].trim();
      const to = m[2].trim();
      if (from === '[*]' && to === '[*]') continue;
      const label = m[3]?.trim();
      const baseKey = getEdgeKey(from, to);
      let id = baseKey;
      if (seenIds.has(id)) {
        id = `${baseKey}#${edges.length}`;
      }
      seenIds.add(id);
      const note =
        notes?.edges[id] ||
        notes?.edges[baseKey] ||
        (notes?.edges
          ? Object.entries(notes.edges).find(
              ([k]) =>
                (k.includes(from) && k.includes(to)) ||
                (k.includes(cleanNodeId(from)) && k.includes(cleanNodeId(to)))
            )?.[1]
          : undefined);
      const prio = label ? extractPriorityFromText(label) : null;
      const condition = label ? extractCleanCondition(label) : undefined;
      edges.push({
        id,
        from,
        to,
        label,
        hasNote: Boolean(note),
        note,
        priority: prio ? prio.priority : undefined,
        condition,
      });
    }
  }

  return edges;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Injects user-defined notes for nodes and edges into Mermaid source code
 * so they render natively in the viewer and in mermaid.live.
 */
export function applyNotesToMermaid(
  mermaidCode: string,
  notes: DiagramNotes
): string {
  if (!mermaidCode || (!Object.keys(notes.nodes || {}).length && !Object.keys(notes.edges || {}).length)) {
    return mermaidCode;
  }

  const isFlowchart = mermaidCode.includes('flowchart') || mermaidCode.includes('graph');
  let result = mermaidCode;

  // 1. Apply Edge Notes
  const edgeEntries = Object.entries(notes.edges || {}).filter(([, note]) => Boolean(note && note.trim()));
  if (edgeEntries.length > 0) {
    const availableEdges = extractEdgesFromMermaid(result, notes);

    for (const [edgeKey, rawNote] of edgeEntries) {
      const parsed = parseEdgeKey(edgeKey, availableEdges);
      if (!parsed) continue;

      const { from, to, index } = parsed;
      // Multi-line note formatting for Mermaid note card (<br/>)
      // Note card MUST ONLY show the user's typed text (no icons, no transition edge descriptions)
      const cleanNote = sanitizeNoteForMermaid(rawNote)
        .replace(/\r\n/g, '<br/>')
        .replace(/[\r\n]/g, '<br/>')
        .trim();
      if (!cleanNote) continue;

      const plainNote = cleanNote.replace(/<br\s*\/?>/gi, ' ');
      const targetIndex = index !== undefined && !isNaN(index) ? index : 0;
      const cleanFrom = cleanNodeId(from) || from;
      const cleanTo = cleanNodeId(to) || to;

      // Resolve targetFrom from existing identifiers in result
      let targetFrom = cleanFrom;
      if (new RegExp(`\\b${escapeRegex(cleanFrom)}\\b`).test(result)) {
        targetFrom = cleanFrom;
      } else if (new RegExp(`\\b${escapeRegex(from)}\\b`).test(result)) {
        targetFrom = from;
      }

      // Resolve targetTo from existing identifiers in result
      let targetTo = cleanTo;
      if (new RegExp(`\\b${escapeRegex(cleanTo)}\\b`).test(result)) {
        targetTo = cleanTo;
      } else if (new RegExp(`\\b${escapeRegex(to)}\\b`).test(result)) {
        targetTo = to;
      }

      if (isFlowchart) {
        const fromCandidates = Array.from(new Set([from, cleanFrom])).filter(Boolean);
        const toCandidates = Array.from(new Set([to, cleanTo])).filter(Boolean);
        const escFrom = fromCandidates.map(escapeRegex).join('|');
        const escTo = toCandidates.map(escapeRegex).join('|');
        const shapePattern = '(?:\\[[^\\]]*\\]|\\({1,2}[^)]*\\){1,2}|\\{[^}]*\\})*';

        // Clean out any legacy [📝 ...] note strings from the transition edge labels
        // The transition edge description must ONLY show the original condition, untouched
        const rxFlowchartEdge = new RegExp(
          `^([ \\t]*(?:${escFrom})${shapePattern}[ \\t]*(?:-->|-.->|==>|---|--)[ \\t]*)(?:\\|"?([\\s\\S]*?)"?\\|[ \\t]*)?((?:${escTo})${shapePattern}[ \\t]*)\\r?$`,
          'gm'
        );

        result = result.replace(rxFlowchartEdge, (full, prefix, existingLabel, suffix) => {
          if (!existingLabel) return full;
          const cleanLabel = existingLabel.replace(/(?:<br\s*\/?>\s*📝?.*|\[📝[^\]]*\])/, '').trim();
          return cleanLabel ? `${prefix}|"${cleanLabel}"| ${suffix}` : `${prefix}${suffix}`;
        });

        // Add note card node for edge in flowchart
        // Content contains ONLY the typed text (no icons, no transition edge descriptions)
        const safeEdgeId = `${targetFrom}_${cleanTo}_${targetIndex}`.replace(/[^A-Za-z0-9_]/g, '_');
        const noteNodeId = `note_edge_${safeEdgeId}`;

        if (!result.includes(noteNodeId)) {
          const noteStyle =
            notes.styles?.[edgeKey] ||
            notes.styles?.[`${from}->${to}`] ||
            notes.styles?.[`${cleanFrom}->${cleanTo}`] ||
            notes.styles?.[`edge-${edgeKey}`];
          const fill = noteStyle?.fill || '#fffbeb';
          const color = noteStyle?.color || '#78350f';
          const stroke = noteStyle?.stroke || '#f59e0b';
          const strokeWidth = noteStyle?.strokeWidth || '1.5px';

          // Note card with ONLY typed text, positioned adjacent to targetTo with an invisible link (no dashed line)
          // Similar to a note attached to a node, positioned as close as possible to the target node
          const noteSnippet = [
            `    ${noteNodeId}["<span style='font-size:11px;font-weight:500;line-height:1.35;'>${cleanNote}</span>"]`,
            `    ${targetTo} ~~~ ${noteNodeId}`,
            `    style ${noteNodeId} fill:${fill},color:${color},stroke:${stroke},stroke-width:${strokeWidth}`,
          ].join('\n');

          // To ensure the note is positioned as close as possible to the target node (and inside the same subgraph if applicable):
          // 1. Check if targetTo is declared in the code (place right after target node declaration)
          // 2. Check if the transition line into targetTo exists (place right after transition line)
          // 3. Fallback to targetFrom declaration or append to diagram
          const rxToDecl = new RegExp(
            `^([ \\t]*${escapeRegex(targetTo)}(?:\\[|\\(|\\{|\\>|:::|\\s*$).*)$`,
            'm'
          );
          const rxTransitionLine = new RegExp(
            `^([ \\t]*(?:${escFrom})${shapePattern}[ \\t]*(?:-->|-.->|==>|---|--)[^\\n]*(?:${escTo})[^\\n]*)$`,
            'm'
          );
          const rxFromDecl = new RegExp(
            `^([ \\t]*${escapeRegex(targetFrom)}(?:\\[|\\(|\\{|\\>|:::|\\s*$).*)$`,
            'm'
          );

          if (rxToDecl.test(result)) {
            // Inject directly after targetTo declaration line so it remains inside the same subgraph and adjacent to the target node
            result = result.replace(rxToDecl, `$1\n${noteSnippet}`);
          } else if (rxTransitionLine.test(result)) {
            // Otherwise inject directly after the transition line pointing to targetTo
            result = result.replace(rxTransitionLine, `$1\n${noteSnippet}`);
          } else if (rxFromDecl.test(result)) {
            result = result.replace(rxFromDecl, `$1\n${noteSnippet}`);
          } else {
            result = `${result.trimEnd()}\n\n${noteSnippet}\n`;
          }
        }
      } else {
        // stateDiagram-v2:
        const fromCandidates = Array.from(new Set([from, cleanFrom])).filter(Boolean);
        const toCandidates = Array.from(new Set([to, cleanTo])).filter(Boolean);
        const escFrom = fromCandidates.map(escapeRegex).join('|');
        const escTo = toCandidates.map(escapeRegex).join('|');

        const rxStateEdge = new RegExp(
          `^([ \\t]*(?:${escFrom})[ \\t]*-->[ \\t]*(?:${escTo})[ \\t]*)(?::[ \\t]*([^\\n\\r]+))?\\r?$`,
          'gm'
        );

        // Clean any legacy [📝...] from transition lines
        result = result.replace(rxStateEdge, (full, prefix, existingLabel) => {
          if (!existingLabel) return full;
          const cleanLabel = existingLabel.replace(/\[📝[^\]]*\]/, '').trim();
          return cleanLabel ? `${prefix}: ${cleanLabel}` : full;
        });

        // stateDiagram-v2 note right of targetTo: ONLY typed text, positioned as close as possible to the target node
        const noteSnippet = `    note right of ${targetTo}: ${plainNote}`;
        const rxStateDef = new RegExp(
          `^([ \\t]*(?:state\\s+"[^"]+"\\s+as\\s+${escapeRegex(targetTo)}|state\\s+${escapeRegex(targetTo)}|${escapeRegex(targetTo)})[ \\t]*)$`,
          'm'
        );
        const rxTransition = new RegExp(
          `^([ \\t]*(?:${escFrom})[ \\t]*-->[ \\t]*(?:${escTo})[^\\n]*)$`,
          'm'
        );

        if (rxStateDef.test(result)) {
          result = result.replace(rxStateDef, `$1\n${noteSnippet}`);
        } else if (rxTransition.test(result)) {
          result = result.replace(rxTransition, `$1\n${noteSnippet}`);
        } else {
          result = `${result.trimEnd()}\n${noteSnippet}\n`;
        }
      }
    }
  }

  // 2. Apply Node Notes
  const nodeEntries = Object.entries(notes.nodes).filter(([, note]) => Boolean(note && note.trim()));
  if (nodeEntries.length > 0) {
    if (isFlowchart) {
      for (const [rawNodeId, rawNote] of nodeEntries) {
        const cleanId = cleanNodeId(rawNodeId) || rawNodeId;
        let targetNodeId = cleanId;
        if (new RegExp(`\\b${escapeRegex(cleanId)}\\b`).test(result)) {
          targetNodeId = cleanId;
        } else if (new RegExp(`\\b${escapeRegex(rawNodeId)}\\b`).test(result)) {
          targetNodeId = rawNodeId;
        }

        // ONLY typed text (no icons)
        const cleanNote = sanitizeNoteForMermaid(rawNote)
          .split('\n')
          .map((l) => l.trim())
          .join('<br/>');
        const safeNodeId = targetNodeId.replace(/[^A-Za-z0-9_]/g, '_');
        const noteNodeId = `note_${safeNodeId}`;

        // Get user custom style for this note if configured
        const noteStyle = notes.styles?.[rawNodeId] || notes.styles?.[cleanId] || notes.styles?.[targetNodeId];
        const fill = noteStyle?.fill || '#fffbeb';
        const color = noteStyle?.color || '#78350f';
        const stroke = noteStyle?.stroke || '#f59e0b';
        const strokeWidth = noteStyle?.strokeWidth || '1.5px';

        const noteSnippet = [
          `    ${noteNodeId}["<span style='font-size:11px;font-weight:500;line-height:1.35;'>${cleanNote}</span>"]`,
          `    ${targetNodeId} ~~~ ${noteNodeId}`,
          `    style ${noteNodeId} fill:${fill},color:${color},stroke:${stroke},stroke-width:${strokeWidth}`,
        ].join('\n');

        // Check if node declaration exists in the code so we can inject INSIDE the same subgraph
        const rxDecl = new RegExp(
          `^([ \\t]*${escapeRegex(targetNodeId)}(?:\\[|\\(|\\{|\\>|:::|\\s*$).*)$`,
          'm'
        );
        const rxTransition = new RegExp(
          `^([ \\t]*${escapeRegex(targetNodeId)}[ \\t]*(?:-->|-.->|==>|---|--)[^\\n]*)$`,
          'm'
        );

        if (rxDecl.test(result)) {
          result = result.replace(rxDecl, `$1\n${noteSnippet}`);
        } else if (rxTransition.test(result)) {
          result = result.replace(rxTransition, `$1\n${noteSnippet}`);
        } else {
          result = `${result.trimEnd()}\n\n${noteSnippet}\n`;
        }
      }
    } else {
      // stateDiagram-v2 supports native notes:
      // note right of StateId
      //     content
      // end note
      const pendingNotes: string[] = [];

      for (const [rawNodeId, rawNote] of nodeEntries) {
        const cleanId = cleanNodeId(rawNodeId) || rawNodeId;
        let targetNodeId = cleanId;
        if (new RegExp(`\\b${escapeRegex(cleanId)}\\b`).test(result)) {
          targetNodeId = cleanId;
        } else if (new RegExp(`\\b${escapeRegex(rawNodeId)}\\b`).test(result)) {
          targetNodeId = rawNodeId;
        }

        const lines = sanitizeNoteForMermaid(rawNote)
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length === 0) continue;

        const noteLines: string[] = [];
        noteLines.push(`    note right of ${targetNodeId}`);
        for (const line of lines) {
          noteLines.push(`        ${line}`);
        }
        noteLines.push(`    end note`);
        const noteBlock = noteLines.join('\n');

        // Try injecting directly where the state is defined or used so it stays inside composite states
        const rxStateDef = new RegExp(
          `^([ \\t]*(?:state\\s+"[^"]+"\\s+as\\s+${escapeRegex(targetNodeId)}|state\\s+${escapeRegex(targetNodeId)}|${escapeRegex(targetNodeId)})[ \\t]*)$`,
          'm'
        );
        const rxStateTrans = new RegExp(
          `^([ \\t]*(?:${escapeRegex(targetNodeId)}|\\[\\*\\])[ \\t]*-->[ \\t]*${escapeRegex(targetNodeId)}[^\\n]*)$`,
          'm'
        );

        if (rxStateDef.test(result)) {
          result = result.replace(rxStateDef, `$1\n${noteBlock}`);
        } else if (rxStateTrans.test(result)) {
          result = result.replace(rxStateTrans, `$1\n${noteBlock}`);
        } else {
          pendingNotes.push(noteBlock);
        }
      }

      if (pendingNotes.length > 0) {
        result = `${result.trimEnd()}\n\n    %% Custom State Notes\n${pendingNotes.join('\n')}\n`;
      }
    }
  }

  return result;
}

/**
 * Counts the total number of notes currently set.
 */
export function countTotalNotes(notes: DiagramNotes): number {
  const nodeNotesCount = Object.values(notes.nodes).filter((n) => Boolean(n && n.trim())).length;
  const edgeNotesCount = Object.values(notes.edges).filter((n) => Boolean(n && n.trim())).length;
  return nodeNotesCount + edgeNotesCount;
}
