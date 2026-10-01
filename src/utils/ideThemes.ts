// Themes after popular IDEs' (VS Code, Visual Studio, JetBrains, and editor themes many of them share): the app's
// colours (Tailwind's greys and its accent, sky, redefined on <html data-ide-theme>; a light one over the light
// palette, data-app-theme="default") and the chart's (Mermaid's base theme with its variables). Each from its IDE's
// own colours: the editor's background, the panels', the borders', the text's, the muted text's, the accent's.

export type IdeThemeId =
  | 'vscode-dark'
  | 'vscode-light'
  | 'vs-dark'
  | 'vs-light'
  | 'jetbrains-darcula'
  | 'jetbrains-dark'
  | 'jetbrains-light'
  | 'monokai'
  | 'one-dark'
  | 'dracula'
  | 'github-dark'
  | 'github-light'
  | 'solarized-dark'
  | 'solarized-light'
  | 'nord';

export interface IdeTheme {
  id: IdeThemeId;
  name: string;
  /** Whose: the IDE or editor it comes from */
  from: string;
  dark: boolean;
  /** The editor's background, the panels', the borders', the muted text's, the text's, the brightest (or darkest) */
  bg: string;
  panel: string;
  border: string;
  muted: string;
  text: string;
  bright: string;
  accent: string;
}

export const IDE_THEMES: IdeTheme[] = [
  { id: 'vscode-dark', name: 'VS Code Dark+', from: 'Visual Studio Code', dark: true, bg: '#1e1e1e', panel: '#252526', border: '#3c3c3c', muted: '#858585', text: '#d4d4d4', bright: '#ffffff', accent: '#007acc' },
  { id: 'vscode-light', name: 'VS Code Light+', from: 'Visual Studio Code', dark: false, bg: '#ffffff', panel: '#f3f3f3', border: '#e5e5e5', muted: '#6e6e6e', text: '#333333', bright: '#000000', accent: '#007acc' },
  { id: 'vs-dark', name: 'Visual Studio Dark', from: 'Visual Studio', dark: true, bg: '#1f1f1f', panel: '#2d2d30', border: '#3f3f46', muted: '#999999', text: '#dcdcdc', bright: '#ffffff', accent: '#0097fb' },
  { id: 'vs-light', name: 'Visual Studio Light', from: 'Visual Studio', dark: false, bg: '#ffffff', panel: '#f5f5f5', border: '#cccedb', muted: '#717171', text: '#1e1e1e', bright: '#000000', accent: '#005fb8' },
  { id: 'jetbrains-darcula', name: 'JetBrains Darcula', from: 'JetBrains (IntelliJ, Rider, CLion …)', dark: true, bg: '#2b2b2b', panel: '#3c3f41', border: '#515151', muted: '#808080', text: '#a9b7c6', bright: '#ffffff', accent: '#4a88c7' },
  { id: 'jetbrains-dark', name: 'JetBrains Dark (New UI)', from: 'JetBrains (IntelliJ, Rider, CLion …)', dark: true, bg: '#1e1f22', panel: '#2b2d30', border: '#393b40', muted: '#6f737a', text: '#dfe1e5', bright: '#ffffff', accent: '#3574f0' },
  { id: 'jetbrains-light', name: 'IntelliJ Light', from: 'JetBrains (IntelliJ, Rider, CLion …)', dark: false, bg: '#ffffff', panel: '#f7f8fa', border: '#ebecf0', muted: '#818594', text: '#080808', bright: '#000000', accent: '#3574f0' },
  { id: 'monokai', name: 'Monokai', from: 'Sublime Text, VS Code, JetBrains', dark: true, bg: '#272822', panel: '#1e1f1c', border: '#3e3d32', muted: '#75715e', text: '#f8f8f2', bright: '#ffffff', accent: '#66d9ef' },
  { id: 'one-dark', name: 'One Dark Pro', from: 'Atom, VS Code', dark: true, bg: '#282c34', panel: '#21252b', border: '#3e4451', muted: '#5c6370', text: '#abb2bf', bright: '#ffffff', accent: '#61afef' },
  { id: 'dracula', name: 'Dracula', from: 'VS Code, JetBrains, Visual Studio', dark: true, bg: '#282a36', panel: '#21222c', border: '#44475a', muted: '#6272a4', text: '#f8f8f2', bright: '#ffffff', accent: '#bd93f9' },
  { id: 'github-dark', name: 'GitHub Dark', from: 'GitHub, VS Code', dark: true, bg: '#0d1117', panel: '#161b22', border: '#30363d', muted: '#8b949e', text: '#c9d1d9', bright: '#f0f6fc', accent: '#58a6ff' },
  { id: 'github-light', name: 'GitHub Light', from: 'GitHub, VS Code', dark: false, bg: '#ffffff', panel: '#f6f8fa', border: '#d0d7de', muted: '#57606a', text: '#24292f', bright: '#000000', accent: '#0969da' },
  { id: 'solarized-dark', name: 'Solarized Dark', from: 'VS Code, JetBrains, Vim', dark: true, bg: '#002b36', panel: '#073642', border: '#2a4d55', muted: '#586e75', text: '#93a1a1', bright: '#fdf6e3', accent: '#268bd2' },
  { id: 'solarized-light', name: 'Solarized Light', from: 'VS Code, JetBrains, Vim', dark: false, bg: '#fdf6e3', panel: '#eee8d5', border: '#d6cfb9', muted: '#93a1a1', text: '#586e75', bright: '#002b36', accent: '#268bd2' },
  { id: 'nord', name: 'Nord', from: 'VS Code, JetBrains, Visual Studio', dark: true, bg: '#2e3440', panel: '#3b4252', border: '#434c5e', muted: '#7b88a1', text: '#d8dee9', bright: '#eceff4', accent: '#88c0d0' },
];

const byId = new Map(IDE_THEMES.map((t) => [t.id, t]));
export const ideThemeOf = (theme: string | undefined): IdeTheme | null => (theme ? byId.get(theme as IdeThemeId) ?? null : null);
/** A dark theme (the app's own dark, or a dark IDE theme) */
export const isDarkTheme = (theme: string | undefined) => !theme || theme === 'dark' || !!ideThemeOf(theme)?.dark;

// (colours mixed in sRGB: enough for neighbouring shades)
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => `#${rgb(a).map((x, i) => Math.round(x + (rgb(b)[i] - x) * t).toString(16).padStart(2, '0')).join('')}`;

const SHADES = [950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50] as const;
/**
 * A theme's greys as the app uses them, from its background (950) to its brightest text (50): the panels 900, the
 * borders 800, the strong borders 700, the muted text 500, the text 200 (a light theme: the same roles, dark on light)
 */
export function greysOf(t: IdeTheme): Record<number, string> {
  return {
    950: t.bg,
    900: t.panel,
    800: t.border,
    700: mix(t.border, t.muted, 0.45),
    600: mix(t.border, t.muted, 0.8),
    500: t.muted,
    400: mix(t.muted, t.text, 0.45),
    300: mix(t.muted, t.text, 0.75),
    200: t.text,
    100: mix(t.text, t.bright, 0.5),
    50: mix(t.text, t.bright, 0.8),
  };
}
/** Its accent's shades in the same roles: the deep tints (950 … 700: selections), the accent (500), the light ones (text, 400 … 50) */
export function accentOf(t: IdeTheme): Record<number, string> {
  return {
    950: mix(t.accent, t.bg, 0.82),
    900: mix(t.accent, t.bg, 0.68),
    800: mix(t.accent, t.bg, 0.52),
    700: mix(t.accent, t.bg, 0.34),
    600: mix(t.accent, t.bg, 0.14),
    500: t.accent,
    400: mix(t.accent, t.bright, 0.18),
    300: mix(t.accent, t.bright, 0.36),
    200: mix(t.accent, t.bright, 0.55),
    100: mix(t.accent, t.bright, 0.72),
    50: mix(t.accent, t.bright, 0.86),
  };
}

/** The app's CSS for every IDE theme (on <html data-ide-theme>; a light one over data-app-theme="default") */
export function ideThemesCss(): string {
  return IDE_THEMES.map((t) => {
    const sel = t.dark ? `:root[data-ide-theme='${t.id}']` : `:root[data-app-theme='default'][data-ide-theme='${t.id}']`;
    const g = greysOf(t);
    const a = accentOf(t);
    const lines = [
      ...SHADES.map((s) => `  --color-slate-${s}: ${g[s]};`),
      ...SHADES.map((s) => `  --color-sky-${s}: ${a[s]};`),
      ...(t.dark ? [] : [`  --color-white: ${t.bright};`]),
    ];
    return `${sel} {\n  color-scheme: ${t.dark ? 'dark' : 'light'};\n${lines.join('\n')}\n}`;
  }).join('\n');
}

/** The canvas' background (the editor's) */
export const canvasBackgroundOf = (theme: string | undefined): string | null => ideThemeOf(theme)?.bg ?? null;

/** Mermaid's theme for a theme: its own five as they are; an IDE theme: the base theme with its colours */
export function mermaidThemeOptions(theme: string | undefined): { theme: 'dark' | 'neutral' | 'forest' | 'base' | 'default'; themeVariables?: Record<string, string | boolean> } {
  const t = ideThemeOf(theme);
  if (!t) return { theme: (theme as 'dark' | 'neutral' | 'forest' | 'base' | 'default') ?? 'dark' };
  const g = greysOf(t);
  const node = mix(t.panel, t.text, t.dark ? 0.04 : 0.02);
  return {
    theme: 'base',
    themeVariables: {
      darkMode: t.dark,
      background: t.bg,
      fontFamily: 'ui-sans-serif, system-ui, "Segoe UI", sans-serif',
      primaryColor: node,
      primaryTextColor: g[100],
      primaryBorderColor: mix(t.accent, t.border, 0.45),
      secondaryColor: g[800],
      secondaryTextColor: g[100],
      secondaryBorderColor: g[700],
      tertiaryColor: t.panel,
      tertiaryTextColor: g[200],
      tertiaryBorderColor: g[700],
      mainBkg: node,
      nodeBorder: mix(t.accent, t.border, 0.45),
      nodeTextColor: g[100],
      lineColor: g[400],
      textColor: g[200],
      edgeLabelBackground: t.panel,
      clusterBkg: mix(t.bg, t.panel, 0.5),
      clusterBorder: g[700],
      titleColor: g[100],
      noteBkgColor: mix(t.accent, t.bg, 0.8),
      noteTextColor: g[100],
      noteBorderColor: t.accent,
      labelBackgroundColor: t.panel,
      stateLabelColor: g[100],
      stateBkg: node,
      altBackground: t.panel,
      compositeBackground: mix(t.bg, t.panel, 0.5),
      compositeTitleBackground: t.panel,
      transitionColor: g[400],
      transitionLabelColor: g[200],
    },
  };
}
