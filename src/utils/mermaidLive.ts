import { mermaidThemeOptions } from './ideThemes.ts';
import pako from 'pako';

export type LayoutEngine = 'dagre' | 'elk';
export type FlowchartCurve = 'basis' | 'linear' | 'cardinal' | 'stepAfter' | 'monotoneX' | 'natural';
export type MermaidTheme = 'dark' | 'neutral' | 'forest' | 'base' | 'default' | import('./ideThemes.ts').IdeThemeId;

export interface MermaidLiveOptions {
  layout?: LayoutEngine;
  curve?: FlowchartCurve;
  theme?: MermaidTheme;
}

/** An init directive without its securityLevel (mermaid.live asks before it drops one: "Removing securityLevel …") */
export function withoutSecurityLevel(init: string): string {
  return init
    .replace(/\s*['"]?securityLevel['"]?\s*:\s*['"][^'"]*['"]\s*,?/gi, '')
    .replace(/,(\s*\})/g, '$1');
}

export function getMermaidLiveUrl(code: string, options?: MermaidLiveOptions): string {
  const layout = options?.layout ?? 'elk';
  const curve = options?.curve ?? 'basis';
  const ideOptions = mermaidThemeOptions(options?.theme ?? 'dark');
  const theme = ideOptions.theme;
  // (an IDE theme: its colours as the init directive's themeVariables)
  const vars = ideOptions.themeVariables ? `, 'themeVariables': ${JSON.stringify(ideOptions.themeVariables).replace(/"/g, "'")}` : '';

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
        if (vars && !/themeVariables/.test(updated)) updated = updated.replace(/%%\{init:\s*\{/, `%%{init: {${vars.slice(2)}, `);
      } else {
        updated = updated.replace(/%%\{init:\s*\{/, `%%{init: {'theme': '${theme}'${vars}, `);
      }
      if (/['"]?layout['"]?\s*:/i.test(updated)) {
        updated = updated.replace(/(['"]?layout['"]?\s*:\s*['"])[^'"]+(['"])/i, `$1${layout}$2`);
      } else {
        updated = updated.replace(/%%\{init:\s*\{/, `%%{init: {'layout': '${layout}', `);
      }
      // (no securityLevel: mermaid.live takes "loose" out itself, asking first in a dialog each time)
      return withoutSecurityLevel(updated);
    });
  } else {
    codeWithTheme = `%%{init: {'theme': '${theme}'${vars}, 'layout': '${layout}', 'flowchart': {'defaultRenderer': '${layout}', 'curve': '${curve}', 'htmlLabels': true}}}%%\n${codeWithTheme}`;
  }

  const state = {
    code: codeWithTheme,
    mermaid: JSON.stringify({
      theme,
      layout,
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
