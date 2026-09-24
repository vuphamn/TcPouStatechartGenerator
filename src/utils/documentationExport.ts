import { DiagramNotes, CustomNodeStylesMap, StateNodeInfo } from '../types.ts';
import { triggerDownload } from './diagramExport.ts';

export interface DocumentationExportOptions {
  fileName?: string;
  states: StateNodeInfo[];
  notes?: DiagramNotes;
  customStyles?: CustomNodeStylesMap;
  currentEditingStateId?: string;
  currentEditingDocText?: string;
}

/**
 * Sanitizes base file name for export (removes .TcPOU, .statechart, special characters).
 */
export function sanitizeDocFileName(fileName?: string): string {
  if (!fileName || !fileName.trim()) return 'state_machine';
  return fileName
    .replace(/\.statechart/gi, '')
    .replace(/\.TcPOU/gi, '')
    .replace(/\.xml/gi, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'state_machine';
}

/**
 * Merges saved annotations with any in-progress edits for a comprehensive map of documentation.
 */
export function compileStateDocumentationMap(options: DocumentationExportOptions): Record<string, string> {
  const map: Record<string, string> = { ...(options.notes?.nodes || {}) };

  // If user is currently editing a state's documentation in the inspector, reflect their latest uncommitted text
  if (options.currentEditingStateId) {
    const text = (options.currentEditingDocText ?? '').trim();
    if (text) {
      map[options.currentEditingStateId] = text;
    }
  }

  return map;
}

/**
 * Generates a comprehensive, publication-ready GitHub-flavored Markdown report of all states and annotations.
 */
export function generateDocumentationMarkdown(options: DocumentationExportOptions): string {
  const baseName = sanitizeDocFileName(options.fileName);
  const titleName = options.fileName || 'TwinCAT State Machine';
  const docMap = compileStateDocumentationMap(options);
  const now = new Date();
  const dateStr = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  // Build sorted list of all unique states
  const stateIdsSet = new Set<string>();
  const stateLabelsMap: Record<string, string> = {};

  for (const s of options.states) {
    stateIdsSet.add(s.id);
    stateLabelsMap[s.id] = s.label || s.id;
  }

  // Also include any notes that might belong to states not in the current list
  for (const id of Object.keys(docMap)) {
    stateIdsSet.add(id);
    if (!stateLabelsMap[id]) {
      stateLabelsMap[id] = id;
    }
  }

  const allStateIds = Array.from(stateIdsSet).sort((a, b) => a.localeCompare(b));
  const totalStates = allStateIds.length;
  const documentedStates = allStateIds.filter((id) => Boolean(docMap[id]?.trim()));
  const totalWords = allStateIds.reduce((acc, id) => {
    const text = docMap[id]?.trim();
    return acc + (text ? text.split(/\s+/).length : 0);
  }, 0);

  const edgeNotes = options.notes?.edges || {};
  const edgeEntries = Object.entries(edgeNotes).filter(([, text]) => Boolean(text?.trim()));

  const lines: string[] = [];

  // Header & Metadata
  lines.push(`# TwinCAT State Machine Documentation: ${titleName}`);
  lines.push('');
  lines.push(`> Generated automatically by TwinCAT StateChart Generator on **${dateStr}**.`);
  lines.push('');
  lines.push('## Executive Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| :--- | :--- |');
  lines.push(`| **POU / Diagram Source** | \`${titleName}\` |`);
  lines.push(`| **Total States** | ${totalStates} |`);
  lines.push(`| **Documented States** | ${documentedStates.length} / ${totalStates} (${totalStates > 0 ? Math.round((documentedStates.length / totalStates) * 100) : 0}%) |`);
  lines.push(`| **Total Documentation Words** | ${totalWords.toLocaleString()} words |`);
  lines.push(`| **Transition Annotations** | ${edgeEntries.length} edge note(s) |`);
  lines.push('');

  // Table of Contents
  lines.push('## Table of Contents');
  lines.push('');
  for (const id of allStateIds) {
    const hasDoc = Boolean(docMap[id]?.trim());
    const anchor = id.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    lines.push(`- [${id}](#${anchor}) ${hasDoc ? '*(Documented)*' : '*(No description)*'}`);
  }
  if (edgeEntries.length > 0) {
    lines.push('- [Transition & Guard Annotations](#transition--guard-annotations)');
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Detailed State Specifications
  lines.push('## State Specifications');
  lines.push('');

  for (const id of allStateIds) {
    const label = stateLabelsMap[id] || id;
    const doc = docMap[id]?.trim();
    const style = options.customStyles?.[id];
    const styleDesc = style?.fill
      ? `Fill: \`${style.fill}\`, Border: \`${style.stroke || '#475569'}\``
      : 'Default Theme';

    lines.push(`### \`${id}\``);
    lines.push('');
    lines.push(`- **State Label:** \`${label}\``);
    lines.push(`- **Canvas Styling:** ${styleDesc}`);
    if (doc) {
      const wordCount = doc.split(/\s+/).length;
      lines.push(`- **Documentation Status:** Completed (${wordCount} words)`);
    } else {
      lines.push('- **Documentation Status:** *Not documented yet*');
    }
    lines.push('');
    lines.push('#### Purpose & Specification');
    lines.push('');

    if (doc) {
      lines.push(doc);
    } else {
      lines.push('*No documentation has been recorded for this state. Add descriptions in the Inspector "Documentation" tab.*');
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Edge / Transition Annotations
  if (edgeEntries.length > 0) {
    lines.push('## Transition & Guard Annotations');
    lines.push('');
    lines.push('| Transition | Condition / Guard Annotation |');
    lines.push('| :--- | :--- |');
    for (const [edgeKey, note] of edgeEntries) {
      const cleanEdge = edgeKey.replace('->', ' &rarr; ');
      const cleanNote = (note || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
      lines.push(`| \`${cleanEdge}\` | ${cleanNote} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generates a structured JSON object containing all state documentation, metadata, and diagram annotations.
 */
export function generateDocumentationJson(options: DocumentationExportOptions): Record<string, unknown> {
  const titleName = options.fileName || 'TwinCAT State Machine';
  const docMap = compileStateDocumentationMap(options);
  const now = new Date();

  const stateIdsSet = new Set<string>();
  const stateLabelsMap: Record<string, string> = {};

  for (const s of options.states) {
    stateIdsSet.add(s.id);
    stateLabelsMap[s.id] = s.label || s.id;
  }

  for (const id of Object.keys(docMap)) {
    stateIdsSet.add(id);
    if (!stateLabelsMap[id]) stateLabelsMap[id] = id;
  }

  const allStateIds = Array.from(stateIdsSet).sort((a, b) => a.localeCompare(b));
  const documentedStates = allStateIds.filter((id) => Boolean(docMap[id]?.trim()));

  const statesData = allStateIds.map((id) => {
    const text = docMap[id]?.trim() || '';
    const wordCount = text ? text.split(/\s+/).length : 0;
    return {
      id,
      label: stateLabelsMap[id] || id,
      hasDocumentation: Boolean(text),
      wordCount,
      documentation: text,
      style: options.customStyles?.[id] || null,
      noteStyle: options.notes?.styles?.[id] || null,
    };
  });

  return {
    schemaVersion: '1.0.0',
    metadata: {
      title: `${titleName} State Machine Documentation`,
      sourceFileName: options.fileName || 'state_machine.TcPOU',
      exportedAt: now.toISOString(),
      totalStates: allStateIds.length,
      documentedStates: documentedStates.length,
      completionRate: allStateIds.length > 0 ? (documentedStates.length / allStateIds.length) : 0,
      totalWords: statesData.reduce((sum, s) => sum + s.wordCount, 0),
    },
    states: statesData,
    annotations: {
      nodes: docMap,
      edges: options.notes?.edges || {},
      styles: options.notes?.styles || {},
      positions: options.notes?.positions || {},
    },
  };
}

/**
 * Exports documentation to a file and triggers browser download.
 */
export function exportDocumentation(
  format: 'markdown' | 'json',
  options: DocumentationExportOptions
): { fileName: string; byteLength: number } {
  const baseName = sanitizeDocFileName(options.fileName);

  if (format === 'markdown') {
    const markdownContent = generateDocumentationMarkdown(options);
    const fileName = `${baseName}_documentation.md`;
    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
    triggerDownload(blob, fileName);
    return { fileName, byteLength: blob.size };
  } else {
    const jsonData = generateDocumentationJson(options);
    const jsonString = JSON.stringify(jsonData, null, 2);
    const fileName = `${baseName}_documentation.json`;
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    triggerDownload(blob, fileName);
    return { fileName, byteLength: blob.size };
  }
}
