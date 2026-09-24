import { DiagramPreset, PresetExportSettings } from '../types.ts';
import { LayoutEngine, FlowchartCurve, MermaidTheme } from '../components/MermaidViewer.tsx';
import { PriorityFormat } from '../generator.ts';

export const STORAGE_KEY_USER_PRESETS = 'tc_statechart_user_presets';
export const STORAGE_KEY_ACTIVE_PRESET = 'tc_statechart_active_preset_id';

export const DEFAULT_EXPORT_SETTINGS: PresetExportSettings = {
  format: 'png',
  scale: 2,
  background: 'dark',
};

export const BUILTIN_PRESETS: DiagramPreset[] = [
  {
    id: 'builtin-twincat-dark',
    name: 'TwinCAT Dark (Default)',
    layoutEngine: 'elk',
    flowchartCurve: 'basis',
    mermaidTheme: 'dark',
    priorityFormat: 'circled',
    exportSettings: {
      format: 'png',
      scale: 2,
      background: 'dark',
    },
    isBuiltin: true,
    description: 'ELK layered routing with smooth spline curves, dark theme, circled Unicode priorities (①), and 2x dark PNG export.',
  },
  {
    id: 'builtin-orthogonal-eng',
    name: 'Orthogonal Engineering',
    layoutEngine: 'elk',
    flowchartCurve: 'stepAfter',
    mermaidTheme: 'base',
    priorityFormat: 'bracket',
    exportSettings: {
      format: 'svg',
      scale: 2,
      background: 'white',
    },
    isBuiltin: true,
    description: 'Clean orthogonal step-after routing, base slate palette, standard bracketed priorities ([1]), and white vector SVG export.',
  },
  {
    id: 'builtin-compact-dagre',
    name: 'Compact Dagre',
    layoutEngine: 'dagre',
    flowchartCurve: 'linear',
    mermaidTheme: 'neutral',
    priorityFormat: 'paren',
    exportSettings: {
      format: 'png',
      scale: 1,
      background: 'transparent',
    },
    isBuiltin: true,
    description: 'Classic high-speed Dagre hierarchical layout with direct linear links, parenthesized priorities ((1)), and transparent PNG export.',
  },
  {
    id: 'builtin-forest-contrast',
    name: 'Forest High-Contrast',
    layoutEngine: 'elk',
    flowchartCurve: 'natural',
    mermaidTheme: 'forest',
    priorityFormat: 'circled',
    exportSettings: {
      format: 'png',
      scale: 3,
      background: 'dark',
    },
    isBuiltin: true,
    description: 'High-contrast industrial forest aesthetic with natural spline curves, circled priorities, and 3x ultra-crisp print PNG export.',
  },
  {
    id: 'builtin-doc-print',
    name: 'Documentation Print',
    layoutEngine: 'dagre',
    flowchartCurve: 'basis',
    mermaidTheme: 'default',
    priorityFormat: 'paren',
    exportSettings: {
      format: 'svg',
      scale: 4,
      background: 'white',
    },
    isBuiltin: true,
    description: 'Light background presentation theme with standard parenthesized priorities and 4x ultra lossless vector SVG export.',
  },
];

export interface DiagramOptionsState {
  layoutEngine: LayoutEngine;
  flowchartCurve: FlowchartCurve;
  mermaidTheme: MermaidTheme;
  priorityFormat: PriorityFormat;
  exportSettings: PresetExportSettings;
}

/**
 * Loads custom user presets from localStorage
 */
export function loadUserPresets(): DiagramPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_USER_PRESETS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (p): p is DiagramPreset =>
            p &&
            typeof p === 'object' &&
            typeof p.id === 'string' &&
            typeof p.name === 'string' &&
            (p.layoutEngine === 'elk' || p.layoutEngine === 'dagre') &&
            typeof p.flowchartCurve === 'string' &&
            typeof p.mermaidTheme === 'string' &&
            (p.priorityFormat === 'circled' || p.priorityFormat === 'paren' || p.priorityFormat === 'bracket')
        )
        .map((p) => {
          // Normalize exportSettings if present or missing
          let exportSettings: PresetExportSettings = DEFAULT_EXPORT_SETTINGS;
          if (p.exportSettings && typeof p.exportSettings === 'object') {
            const exp = p.exportSettings as Partial<PresetExportSettings>;
            exportSettings = {
              format: exp.format === 'svg' ? 'svg' : 'png',
              scale: (exp.scale === 1 || exp.scale === 2 || exp.scale === 3 || exp.scale === 4) ? exp.scale : 2,
              background: (exp.background === 'white' || exp.background === 'transparent') ? exp.background : 'dark',
            };
          }
          return {
            ...p,
            exportSettings,
          };
        });
    }
  } catch (err) {
    console.warn('[DiagramPresets] Failed to load user presets from localStorage', err);
  }
  return [];
}

/**
 * Saves custom user presets to localStorage
 */
export function saveUserPresets(presets: DiagramPreset[]): void {
  try {
    const customOnly = presets.filter((p) => !p.isBuiltin);
    localStorage.setItem(STORAGE_KEY_USER_PRESETS, JSON.stringify(customOnly));
  } catch (err) {
    console.warn('[DiagramPresets] Failed to save user presets to localStorage', err);
  }
}

/**
 * Loads the active preset ID from localStorage
 */
export function loadActivePresetId(): string {
  try {
    const active = localStorage.getItem(STORAGE_KEY_ACTIVE_PRESET);
    if (active) return active;
  } catch {
    // ignore
  }
  return 'builtin-twincat-dark';
}

/**
 * Saves the active preset ID to localStorage
 */
export function saveActivePresetId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_ACTIVE_PRESET, id);
  } catch {
    // ignore
  }
}

/**
 * Checks if current diagram options and export settings match the preset properties
 */
export function optionsMatchPreset(preset: DiagramPreset, current: DiagramOptionsState): boolean {
  const optionsMatch =
    preset.layoutEngine === current.layoutEngine &&
    preset.flowchartCurve === current.flowchartCurve &&
    preset.mermaidTheme === current.mermaidTheme &&
    preset.priorityFormat === current.priorityFormat;

  if (!optionsMatch) return false;

  if (preset.exportSettings && current.exportSettings) {
    return (
      preset.exportSettings.scale === current.exportSettings.scale &&
      preset.exportSettings.format === current.exportSettings.format &&
      preset.exportSettings.background === current.exportSettings.background
    );
  }

  return true;
}

/**
 * Find matching preset among all (user and builtin) presets
 */
export function findMatchingPreset(
  presets: DiagramPreset[],
  current: DiagramOptionsState
): DiagramPreset | undefined {
  return presets.find((p) => optionsMatchPreset(p, current));
}
