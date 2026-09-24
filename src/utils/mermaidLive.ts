import pako from 'pako';

export type LayoutEngine = 'dagre' | 'elk';
export type FlowchartCurve = 'basis' | 'linear' | 'cardinal' | 'stepAfter' | 'monotoneX' | 'natural';
export type MermaidTheme = 'dark' | 'neutral' | 'forest' | 'base' | 'default';

export interface MermaidLiveOptions {
  layout?: LayoutEngine;
  curve?: FlowchartCurve;
  theme?: MermaidTheme;
}

export function getMermaidLiveUrl(code: string, options?: MermaidLiveOptions): string {
  const layout = options?.layout ?? 'elk';
  const curve = options?.curve ?? 'basis';
  const theme = options?.theme ?? 'dark';

  // Inject theme and layout directives into Mermaid source code so mermaid.live always renders
  // with the user's selected theme (dark, neutral, forest, base, default) and layout engine (elk, dagre).
  let codeWithTheme = code.trim();
  const initRegex = /%%\{init:\s*\{[\s\S]*?\}\s*\}%%/;
  if (initRegex.test(codeWithTheme)) {
    // If an existing init directive is found, update or insert the theme & layout properties
    codeWithTheme = codeWithTheme.replace(initRegex, (match) => {
      let updated = match;
      if (/['"]?theme['"]?\s*:/i.test(updated)) {
        updated = updated.replace(/(['"]?theme['"]?\s*:\s*['"])[^'"]+(['"])/i, `$1${theme}$2`);
      } else {
        updated = updated.replace(/%%\{init:\s*\{/, `%%{init: {'theme': '${theme}', `);
      }
      if (/['"]?layout['"]?\s*:/i.test(updated)) {
        updated = updated.replace(/(['"]?layout['"]?\s*:\s*['"])[^'"]+(['"])/i, `$1${layout}$2`);
      } else {
        updated = updated.replace(/%%\{init:\s*\{/, `%%{init: {'layout': '${layout}', `);
      }
      if (/['"]?securityLevel['"]?\s*:/i.test(updated)) {
        updated = updated.replace(/(['"]?securityLevel['"]?\s*:\s*['"])[^'"]+(['"])/i, `$1loose$2`);
      } else {
        updated = updated.replace(/%%\{init:\s*\{/, `%%{init: {'securityLevel': 'loose', `);
      }
      return updated;
    });
  } else {
    codeWithTheme = `%%{init: {'theme': '${theme}', 'layout': '${layout}', 'securityLevel': 'loose', 'flowchart': {'defaultRenderer': '${layout}', 'curve': '${curve}', 'htmlLabels': true}}}%%\n${codeWithTheme}`;
  }

  const state = {
    code: codeWithTheme,
    mermaid: JSON.stringify({
      theme,
      layout,
      securityLevel: 'loose',
      flowchart: { curve, htmlLabels: true },
      state: { useMaxWidth: false },
    }),
    autoSync: true,
    updateDiagram: true,
  };
  const jsonStr = JSON.stringify(state);
  const data = new TextEncoder().encode(jsonStr);
  const compressed = pako.deflate(data, { level: 9 });

  let binary = '';
  for (let i = 0; i < compressed.byteLength; i++) {
    binary += String.fromCharCode(compressed[i]);
  }
  const base64 = btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `https://mermaid.live/edit#pako:${base64}`;
}
