import React, { useState } from 'react';
import {
  Palette,
  X,
  RotateCcw,
  Sparkles,
  Sliders,
  Check,
} from 'lucide-react';
import { NodeDisplayProperties } from '../types.ts';

export interface NoteStylePreset {
  id: string;
  name: string;
  fill: string;
  color: string;
  stroke: string;
  strokeWidth: string;
}

export const NOTE_COLOR_PRESETS: NoteStylePreset[] = [
  {
    id: 'amber-classic',
    name: 'Amber Sticky',
    fill: '#fffbeb',
    color: '#78350f',
    stroke: '#f59e0b',
    strokeWidth: '1.5px',
  },
  {
    id: 'canary-yellow',
    name: 'Canary Yellow',
    fill: '#fef08a',
    color: '#713f12',
    stroke: '#eab308',
    strokeWidth: '1.5px',
  },
  {
    id: 'emerald-mint',
    name: 'Mint Success',
    fill: '#064e3b',
    color: '#ecfdf5',
    stroke: '#10b981',
    strokeWidth: '1.5px',
  },
  {
    id: 'sky-info',
    name: 'Sky Active',
    fill: '#0c4a6e',
    color: '#f0f9ff',
    stroke: '#0284c7',
    strokeWidth: '1.5px',
  },
  {
    id: 'rose-alert',
    name: 'Rose Alert',
    fill: '#881337',
    color: '#ffe4e6',
    stroke: '#f43f5e',
    strokeWidth: '1.5px',
  },
  {
    id: 'indigo-focus',
    name: 'Indigo Setup',
    fill: '#312e81',
    color: '#e0e7ff',
    stroke: '#6366f1',
    strokeWidth: '1.5px',
  },
  {
    id: 'purple-special',
    name: 'Purple Mode',
    fill: '#581c87',
    color: '#fae8ff',
    stroke: '#a855f7',
    strokeWidth: '1.5px',
  },
  {
    id: 'slate-dark',
    name: 'Slate Dark',
    fill: '#1e293b',
    color: '#f1f5f9',
    stroke: '#475569',
    strokeWidth: '1.5px',
  },
  {
    id: 'clean-white',
    name: 'Clean White',
    fill: '#ffffff',
    color: '#0f172a',
    stroke: '#cbd5e1',
    strokeWidth: '1.5px',
  },
];

export const NOTE_BG_SWATCHES = [
  { label: 'Amber', value: '#fffbeb' },
  { label: 'Canary', value: '#fef08a' },
  { label: 'White', value: '#ffffff' },
  { label: 'Sand', value: '#fef3c7' },
  { label: 'Emerald', value: '#064e3b' },
  { label: 'Sky', value: '#0c4a6e' },
  { label: 'Rose', value: '#881337' },
  { label: 'Indigo', value: '#312e81' },
  { label: 'Purple', value: '#581c87' },
  { label: 'Slate', value: '#1e293b' },
];

export const NOTE_TEXT_SWATCHES = [
  { label: 'Amber', value: '#78350f' },
  { label: 'Brown', value: '#713f12' },
  { label: 'Slate Dark', value: '#0f172a' },
  { label: 'Charcoal', value: '#1e293b' },
  { label: 'White', value: '#ffffff' },
  { label: 'Mint', value: '#ecfdf5' },
  { label: 'Sky', value: '#f0f9ff' },
  { label: 'Coral', value: '#ffe4e6' },
  { label: 'Lavender', value: '#fae8ff' },
];

export const NOTE_BORDER_SWATCHES = [
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Gold', value: '#eab308' },
  { label: 'Emerald', value: '#10b981' },
  { label: 'Sky', value: '#0284c7' },
  { label: 'Rose', value: '#f43f5e' },
  { label: 'Indigo', value: '#6366f1' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Slate', value: '#475569' },
  { label: 'Light', value: '#cbd5e1' },
];

export const NOTE_BORDER_WIDTHS = [
  { label: '1px', value: '1px' },
  { label: '2px', value: '2px' },
  { label: '3px', value: '3px' },
];

export interface NoteStylePopoverProps {
  noteId: string;
  noteLabel: string;
  currentStyle?: NodeDisplayProperties;
  onUpdateStyle: (style: NodeDisplayProperties | null) => void;
  onClose: () => void;
}

export const NoteStylePopover: React.FC<NoteStylePopoverProps> = ({
  noteId,
  noteLabel,
  currentStyle = {},
  onUpdateStyle,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('presets');

  const currentFill = currentStyle.fill || '#fffbeb';
  const currentColor = currentStyle.color || '#78350f';
  const currentStroke = currentStyle.stroke || '#f59e0b';
  const currentStrokeWidth = currentStyle.strokeWidth || '1.5px';

  const isCustomized = Boolean(
    currentStyle.fill || currentStyle.color || currentStyle.stroke || currentStyle.strokeWidth
  );

  const handleApplyPreset = (preset: NoteStylePreset) => {
    onUpdateStyle({
      fill: preset.fill,
      color: preset.color,
      stroke: preset.stroke,
      strokeWidth: preset.strokeWidth,
    });
  };

  const handleUpdate = (updates: Partial<NodeDisplayProperties>) => {
    const next: NodeDisplayProperties = {
      fill: currentFill,
      color: currentColor,
      stroke: currentStroke,
      strokeWidth: currentStrokeWidth,
      ...updates,
    };
    onUpdateStyle(next);
  };

  const handleReset = () => {
    onUpdateStyle(null);
  };

  return (
    <div
      id={`note-style-popover-${noteId}`}
      className="absolute -top-72 left-0 w-72 bg-slate-900/95 dark:bg-slate-900/95 border border-amber-500/80 rounded-xl shadow-2xl backdrop-blur-md text-slate-200 z-50 p-2.5 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-700/80">
        <div className="flex items-center gap-1.5 min-w-0 pr-2">
          <Palette className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="font-semibold text-white truncate text-[11.5px]">
            Note Style: {noteLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-white p-0.5 rounded transition-colors"
          title="Close style menu"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-0.5 mb-2.5 bg-slate-950 rounded-lg border border-slate-800 text-[11px]">
        <button
          type="button"
          onClick={() => setActiveTab('presets')}
          className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md transition-all font-medium ${
            activeTab === 'presets'
              ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-3 h-3" />
          <span>Presets</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('custom')}
          className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md transition-all font-medium ${
            activeTab === 'custom'
              ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3 h-3" />
          <span>Custom Colors</span>
        </button>
      </div>

      {/* Tab: Presets */}
      {activeTab === 'presets' && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-1.5">
            {NOTE_COLOR_PRESETS.map((preset) => {
              const isSelected =
                currentStyle.fill === preset.fill &&
                currentStyle.color === preset.color;

              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleApplyPreset(preset)}
                  style={{
                    backgroundColor: preset.fill,
                    color: preset.color,
                    borderColor: preset.stroke,
                    borderWidth: preset.strokeWidth,
                  }}
                  className={`h-11 rounded-lg border px-1.5 py-1 text-left flex flex-col justify-between transition-all hover:scale-[1.02] shadow-sm relative ${
                    isSelected ? 'ring-2 ring-amber-400 font-bold' : ''
                  }`}
                  title={`${preset.name}: Fill ${preset.fill}, Text ${preset.color}`}
                >
                  <span className="text-[10px] truncate leading-tight font-medium">
                    {preset.name}
                  </span>
                  <div className="flex items-center justify-between">
                    <span className="text-[8.5px] opacity-80">Aa</span>
                    {isSelected && <Check className="w-2.5 h-2.5 text-amber-500" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab: Custom */}
      {activeTab === 'custom' && (
        <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
          {/* Background / Fill Color */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10.5px] font-semibold text-slate-300">
                Background Color
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="color"
                  value={currentFill.startsWith('#') && currentFill.length === 7 ? currentFill : '#fffbeb'}
                  onChange={(e) => handleUpdate({ fill: e.target.value })}
                  className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                  title="Pick custom background"
                />
                <span className="font-mono text-[10px] text-slate-400 uppercase">
                  {currentFill}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {NOTE_BG_SWATCHES.map((swatch) => (
                <button
                  key={swatch.label}
                  type="button"
                  onClick={() => handleUpdate({ fill: swatch.value })}
                  style={{ backgroundColor: swatch.value }}
                  className={`w-5 h-5 rounded border border-slate-600 transition-transform hover:scale-110 ${
                    currentFill.toLowerCase() === swatch.value.toLowerCase()
                      ? 'ring-2 ring-amber-400 scale-105'
                      : ''
                  }`}
                  title={swatch.label}
                />
              ))}
            </div>
          </div>

          {/* Foreground / Text Color */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10.5px] font-semibold text-slate-300">
                Foreground (Text) Color
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="color"
                  value={currentColor.startsWith('#') && currentColor.length === 7 ? currentColor : '#78350f'}
                  onChange={(e) => handleUpdate({ color: e.target.value })}
                  className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                  title="Pick custom text color"
                />
                <span className="font-mono text-[10px] text-slate-400 uppercase">
                  {currentColor}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {NOTE_TEXT_SWATCHES.map((swatch) => (
                <button
                  key={swatch.label}
                  type="button"
                  onClick={() => handleUpdate({ color: swatch.value })}
                  style={{ backgroundColor: swatch.value }}
                  className={`w-5 h-5 rounded border border-slate-600 transition-transform hover:scale-110 ${
                    currentColor.toLowerCase() === swatch.value.toLowerCase()
                      ? 'ring-2 ring-amber-400 scale-105'
                      : ''
                  }`}
                  title={swatch.label}
                />
              ))}
            </div>
          </div>

          {/* Border Color & Width */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10.5px] font-semibold text-slate-300">
                Border & Width
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="color"
                  value={currentStroke.startsWith('#') && currentStroke.length === 7 ? currentStroke : '#f59e0b'}
                  onChange={(e) => handleUpdate({ stroke: e.target.value })}
                  className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                  title="Pick custom border color"
                />
                <div className="flex gap-0.5 ml-1">
                  {NOTE_BORDER_WIDTHS.map((bw) => (
                    <button
                      key={bw.label}
                      type="button"
                      onClick={() => handleUpdate({ strokeWidth: bw.value })}
                      className={`px-1.5 py-0.5 text-[9px] rounded font-mono ${
                        currentStrokeWidth === bw.value
                          ? 'bg-amber-500 text-slate-950 font-bold'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {bw.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {NOTE_BORDER_SWATCHES.map((swatch) => (
                <button
                  key={swatch.label}
                  type="button"
                  onClick={() => handleUpdate({ stroke: swatch.value })}
                  style={{ backgroundColor: swatch.value }}
                  className={`w-5 h-5 rounded border border-slate-600 transition-transform hover:scale-110 ${
                    currentStroke.toLowerCase() === swatch.value.toLowerCase()
                      ? 'ring-2 ring-amber-400 scale-105'
                      : ''
                  }`}
                  title={swatch.label}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer / Reset Action */}
      <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-700/80">
        <button
          type="button"
          onClick={handleReset}
          disabled={!isCustomized}
          className="flex items-center gap-1 px-2 py-1 text-[10.5px] text-slate-400 hover:text-white disabled:opacity-40 rounded hover:bg-slate-800 transition-colors"
          title="Reset note to default sticky styling"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reset Default</span>
        </button>

        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-1 text-[10.5px] font-medium bg-amber-500 hover:bg-amber-400 text-slate-950 rounded transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
};
