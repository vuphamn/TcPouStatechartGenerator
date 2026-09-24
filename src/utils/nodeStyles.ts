import { ColorPreset, CustomNodeStylesMap, NodeDisplayProperties, StateNodeInfo } from '../types.ts';

export const CURATED_COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'emerald-success',
    name: 'Success / Done',
    fill: '#064e3b',
    color: '#ecfdf5',
    stroke: '#10b981',
    strokeWidth: '2px',
    description: 'Dark emerald background with bright mint text & border',
  },
  {
    id: 'sky-info',
    name: 'Active / Running',
    fill: '#0c4a6e',
    color: '#f0f9ff',
    stroke: '#0284c7',
    strokeWidth: '2px',
    description: 'Deep sky blue background with light azure text & border',
  },
  {
    id: 'amber-warning',
    name: 'Warning / Wait',
    fill: '#78350f',
    color: '#fef3c7',
    stroke: '#f59e0b',
    strokeWidth: '2px',
    description: 'Rich amber background with warm gold text & border',
  },
  {
    id: 'rose-fault',
    name: 'Error / Fault',
    fill: '#881337',
    color: '#ffe4e6',
    stroke: '#f43f5e',
    strokeWidth: '2px',
    description: 'Crimson rose background with light coral text & border',
  },
  {
    id: 'indigo-primary',
    name: 'Primary / Setup',
    fill: '#312e81',
    color: '#e0e7ff',
    stroke: '#6366f1',
    strokeWidth: '2px',
    description: 'Vibrant indigo background with crisp lavender text & border',
  },
  {
    id: 'purple-special',
    name: 'Special / Mode',
    fill: '#581c87',
    color: '#fae8ff',
    stroke: '#a855f7',
    strokeWidth: '2px',
    description: 'Deep purple background with soft violet text & border',
  },
  {
    id: 'slate-muted',
    name: 'Muted / Inactive',
    fill: '#1e293b',
    color: '#94a3b8',
    stroke: '#475569',
    strokeWidth: '1px',
    description: 'Slate neutral background with subdued gray text & border',
  },
  {
    id: 'light-card',
    name: 'High Contrast Light',
    fill: '#ffffff',
    color: '#0f172a',
    stroke: '#cbd5e1',
    strokeWidth: '2px',
    description: 'Clean white background with dark text for high legibility',
  },
];

export const QUICK_BG_SWATCHES = [
  { label: 'Default', value: '' },
  { label: 'Emerald', value: '#064e3b' },
  { label: 'Sky', value: '#0c4a6e' },
  { label: 'Amber', value: '#78350f' },
  { label: 'Rose', value: '#881337' },
  { label: 'Indigo', value: '#312e81' },
  { label: 'Purple', value: '#581c87' },
  { label: 'Slate', value: '#1e293b' },
  { label: 'Dark Navy', value: '#090d16' },
  { label: 'Pure White', value: '#ffffff' },
  { label: 'Warm Sand', value: '#fef3c7' },
];

export const QUICK_TEXT_SWATCHES = [
  { label: 'Default', value: '' },
  { label: 'White', value: '#ffffff' },
  { label: 'Slate Light', value: '#e2e8f0' },
  { label: 'Slate Muted', value: '#94a3b8' },
  { label: 'Mint', value: '#6ee7b7' },
  { label: 'Sky', value: '#7dd3fc' },
  { label: 'Gold', value: '#fde047' },
  { label: 'Coral', value: '#fda4af' },
  { label: 'Dark Slate', value: '#0f172a' },
];

export const QUICK_BORDER_SWATCHES = [
  { label: 'Default', value: '' },
  { label: 'Emerald', value: '#10b981' },
  { label: 'Sky', value: '#0284c7' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Rose', value: '#f43f5e' },
  { label: 'Indigo', value: '#6366f1' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Slate', value: '#475569' },
  { label: 'White', value: '#ffffff' },
  { label: 'Dark', value: '#0f172a' },
];

export const BORDER_WIDTH_OPTIONS = [
  { label: '1px', value: '1px' },
  { label: '2px', value: '2px' },
  { label: '3px', value: '3px' },
  { label: '4px', value: '4px' },
];

/**
 * Injects Mermaid style statements for configured custom node styles.
 */
export function applyCustomStylesToMermaid(
  mermaidCode: string,
  customStyles: CustomNodeStylesMap
): string {
  const entries = Object.entries(customStyles).filter(([, style]) => {
    return Boolean(style.fill || style.color || style.stroke || style.strokeWidth);
  });

  if (entries.length === 0) {
    return mermaidCode;
  }

  const styleLines: string[] = [];
  for (const [nodeId, style] of entries) {
    const parts: string[] = [];
    if (style.fill) parts.push(`fill:${style.fill}`);
    if (style.color) parts.push(`color:${style.color}`);
    if (style.stroke) parts.push(`stroke:${style.stroke}`);
    if (style.strokeWidth) parts.push(`stroke-width:${style.strokeWidth}`);

    if (parts.length > 0) {
      styleLines.push(`    style ${nodeId} ${parts.join(',')}`);
    }
  }

  if (styleLines.length === 0) {
    return mermaidCode;
  }

  return `${mermaidCode.trimEnd()}\n\n    %% Custom State Display Styles\n${styleLines.join('\n')}\n`;
}

/**
 * Extracts a list of state nodes from Mermaid diagram source code.
 */
export function extractStateNodesFromMermaid(code: string): StateNodeInfo[] {
  const nodesMap = new Map<string, string>();

  // 1. Flowchart node definitions: NodeId["Label text"] or NodeId("Label")
  const fcPattern = /^\s*([A-Za-z0-9_]+)\s*(\[|\()("[^"]*"|'[^']*'|[^\]\)]+)(\]|\))/gm;
  let match: RegExpExecArray | null;
  while ((match = fcPattern.exec(code)) !== null) {
    const id = match[1];
    if (id === 'startNode' || id === 'classDef' || id === 'subgraph' || id === 'style') continue;
    let label = match[3] || id;
    if ((label.startsWith('"') && label.endsWith('"')) || (label.startsWith("'") && label.endsWith("'"))) {
      label = label.slice(1, -1);
    }
    // Clean up br tags
    label = label.replace(/<br\s*\/?>/gi, ' — ');
    if (!nodesMap.has(id)) {
      nodesMap.set(id, label);
    }
  }

  // 2. Flowchart arrows: A --> B or A -->|label| B
  const arrowPattern = /([A-Za-z0-9_]+)\s*-->/g;
  while ((match = arrowPattern.exec(code)) !== null) {
    const id = match[1];
    if (id === 'startNode') continue;
    if (!nodesMap.has(id)) {
      nodesMap.set(id, id);
    }
  }

  // 3. State diagram definitions: state "Label" as S_NAME or [*] --> S_NAME
  const sdPattern = /state\s+"([^"]+)"\s+as\s+([A-Za-z0-9_]+)/g;
  while ((match = sdPattern.exec(code)) !== null) {
    const label = match[1].replace(/<br\s*\/?>/gi, ' — ');
    const id = match[2];
    nodesMap.set(id, label);
  }

  const result: StateNodeInfo[] = [];
  nodesMap.forEach((label, id) => {
    result.push({ id, label });
  });

  return result.sort((a, b) => a.id.localeCompare(b.id));
}
