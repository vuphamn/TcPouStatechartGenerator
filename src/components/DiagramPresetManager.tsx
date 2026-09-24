import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Bookmark,
  ChevronDown,
  Check,
  Plus,
  Trash2,
  Edit2,
  Save,
  RotateCw,
  Sparkles,
  Layers,
  X,
} from 'lucide-react';
import { DiagramPreset } from '../types.ts';
import { LayoutEngine, FlowchartCurve, MermaidTheme } from './MermaidViewer.tsx';
import { PriorityFormat } from '../generator.ts';
import {
  DiagramOptionsState,
  BUILTIN_PRESETS,
  loadUserPresets,
  saveUserPresets,
  loadActivePresetId,
  saveActivePresetId,
  optionsMatchPreset,
} from '../utils/diagramPresets.ts';

interface DiagramPresetManagerProps {
  currentOptions: DiagramOptionsState;
  onApplyPreset: (preset: DiagramPreset) => void;
}

export const DiagramPresetManager: React.FC<DiagramPresetManagerProps> = ({
  currentOptions,
  onApplyPreset,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [userPresets, setUserPresets] = useState<DiagramPreset[]>(() => loadUserPresets());
  const [activePresetId, setActivePresetId] = useState<string>(() => loadActivePresetId());

  // Save Modal state
  const [isSaveModalOpen, setIsSaveModalOpen] = useState<boolean>(false);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Combine user presets + built-ins
  const allPresets = [...userPresets, ...BUILTIN_PRESETS];

  // Determine which preset matches current options
  const exactMatchingPreset = allPresets.find((p) => optionsMatchPreset(p, currentOptions));
  const activePreset = allPresets.find((p) => p.id === activePresetId) || exactMatchingPreset;

  const isCurrentModified = activePreset ? !optionsMatchPreset(activePreset, currentOptions) : true;

  // Sync active preset ID whenever exact match happens and no custom modification
  useEffect(() => {
    if (exactMatchingPreset && exactMatchingPreset.id !== activePresetId) {
      setActivePresetId(exactMatchingPreset.id);
      saveActivePresetId(exactMatchingPreset.id);
    }
  }, [exactMatchingPreset, activePresetId]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isSaveModalOpen) {
          setIsSaveModalOpen(false);
        } else if (isOpen) {
          setIsOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaveModalOpen]);

  // Auto focus input when modal opens
  useEffect(() => {
    if (isSaveModalOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isSaveModalOpen]);

  // Apply a preset
  const handleSelectPreset = useCallback(
    (preset: DiagramPreset) => {
      setActivePresetId(preset.id);
      saveActivePresetId(preset.id);
      onApplyPreset(preset);
      setIsOpen(false);
    },
    [onApplyPreset]
  );

  // Open Save as New Preset dialog
  const handleOpenSaveDialog = useCallback((existingPreset?: DiagramPreset) => {
    if (existingPreset) {
      setEditingPresetId(existingPreset.id);
      setNewPresetName(existingPreset.name);
    } else {
      setEditingPresetId(null);
      // Generate default informative name based on options
      const themeLabel = currentOptions.mermaidTheme.charAt(0).toUpperCase() + currentOptions.mermaidTheme.slice(1);
      const engineLabel = currentOptions.layoutEngine.toUpperCase();
      setNewPresetName(`Custom ${engineLabel} ${themeLabel}`);
    }
    setIsSaveModalOpen(true);
    setIsOpen(false);
  }, [currentOptions]);

  // Save or Update Preset
  const handleSavePresetSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newPresetName.trim();
    if (!trimmed) return;

    if (editingPresetId) {
      // Update existing preset
      const updated = userPresets.map((p) => {
        if (p.id === editingPresetId) {
          return {
            ...p,
            name: trimmed,
            layoutEngine: currentOptions.layoutEngine,
            flowchartCurve: currentOptions.flowchartCurve,
            mermaidTheme: currentOptions.mermaidTheme,
            priorityFormat: currentOptions.priorityFormat,
          };
        }
        return p;
      });
      setUserPresets(updated);
      saveUserPresets(updated);
      setActivePresetId(editingPresetId);
      saveActivePresetId(editingPresetId);
      setSaveSuccessNotice(`Preset "${trimmed}" updated!`);
    } else {
      // Create new preset
      const newPreset: DiagramPreset = {
        id: `user-preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: trimmed,
        layoutEngine: currentOptions.layoutEngine,
        flowchartCurve: currentOptions.flowchartCurve,
        mermaidTheme: currentOptions.mermaidTheme,
        priorityFormat: currentOptions.priorityFormat,
        isBuiltin: false,
        createdAt: Date.now(),
        description: `Custom preset: ${currentOptions.layoutEngine.toUpperCase()} engine, ${currentOptions.flowchartCurve} curve, ${currentOptions.mermaidTheme} theme, ${currentOptions.priorityFormat} priorities.`,
      };
      const updated = [newPreset, ...userPresets];
      setUserPresets(updated);
      saveUserPresets(updated);
      setActivePresetId(newPreset.id);
      saveActivePresetId(newPreset.id);
      setSaveSuccessNotice(`Preset "${trimmed}" saved to localStorage!`);
    }

    setIsSaveModalOpen(false);
    setTimeout(() => {
      setSaveSuccessNotice(null);
    }, 3000);
  };

  // Overwrite active user preset directly
  const handleOverwriteCurrentPreset = (preset: DiagramPreset) => {
    const updated = userPresets.map((p) => {
      if (p.id === preset.id) {
        return {
          ...p,
          layoutEngine: currentOptions.layoutEngine,
          flowchartCurve: currentOptions.flowchartCurve,
          mermaidTheme: currentOptions.mermaidTheme,
          priorityFormat: currentOptions.priorityFormat,
        };
      }
      return p;
    });
    setUserPresets(updated);
    saveUserPresets(updated);
    setActivePresetId(preset.id);
    saveActivePresetId(preset.id);
    setSaveSuccessNotice(`Updated "${preset.name}" with current diagram settings!`);
    setIsOpen(false);
    setTimeout(() => {
      setSaveSuccessNotice(null);
    }, 3000);
  };

  // Delete a user preset
  const handleDeletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const target = userPresets.find((p) => p.id === id);
    const confirmName = target?.name || 'this preset';
    if (!window.confirm(`Delete "${confirmName}"? This action cannot be undone.`)) {
      return;
    }
    const updated = userPresets.filter((p) => p.id !== id);
    setUserPresets(updated);
    saveUserPresets(updated);
    if (activePresetId === id) {
      setActivePresetId(BUILTIN_PRESETS[0].id);
      saveActivePresetId(BUILTIN_PRESETS[0].id);
    }
  };

  const getPriorityDisplay = (fmt: PriorityFormat) => {
    switch (fmt) {
      case 'circled':
        return '① Unicode';
      case 'bracket':
        return '[1] Bracket';
      case 'paren':
        return '(1) Paren';
    }
  };

  return (
    <div className="relative inline-flex items-center" ref={dropdownRef}>
      {/* Preset Selector Pill / Button */}
      <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
        <button
          id="diagram-presets-toggle-btn"
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-all ${
            isOpen
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-300 hover:text-white hover:bg-slate-900/90'
          }`}
          title="Diagram Presets: Quickly toggle or save layout engine, curve interpolation, theme & priority format"
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          <Bookmark className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span className="max-w-[130px] sm:max-w-[170px] truncate text-left">
            {activePreset ? activePreset.name : 'Select Preset'}
          </span>
          {isCurrentModified && (
            <span
              className="text-[9px] font-semibold text-amber-400 bg-amber-950/80 px-1 py-0.2 rounded border border-amber-800/60 leading-none shrink-0"
              title="Options have been modified from preset settings"
            >
              mod
            </span>
          )}
          <ChevronDown
            className={`w-3 h-3 text-slate-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Quick Save Current Button */}
        <button
          id="save-current-preset-quick-btn"
          type="button"
          onClick={() => handleOpenSaveDialog()}
          className="flex items-center gap-1 px-1.5 py-1 text-slate-400 hover:text-sky-300 hover:bg-slate-800 rounded transition-colors ml-0.5"
          title="Save current Diagram options (layout engine, curve, theme, priority format) as a User Preset"
        >
          <Plus className="w-3 h-3 text-sky-400" />
          <span className="hidden xl:inline text-[10px]">Save</span>
        </button>
      </div>

      {/* Floating Success Banner */}
      {saveSuccessNotice && (
        <div className="absolute top-full left-0 mt-1 z-50 px-2.5 py-1 bg-emerald-950 border border-emerald-600/80 text-emerald-200 text-[11px] rounded-md shadow-lg flex items-center gap-1.5 whitespace-nowrap animate-in fade-in slide-in-from-top-1">
          <Check className="w-3 h-3 text-emerald-400" />
          <span>{saveSuccessNotice}</span>
        </div>
      )}

      {/* Presets Dropdown Menu */}
      {isOpen && (
        <div
          id="diagram-presets-dropdown-menu"
          className="absolute top-full left-0 mt-1.5 w-80 max-h-[460px] overflow-y-auto bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 text-xs text-slate-300 py-1.5 backdrop-blur-md"
          role="menu"
        >
          {/* Header */}
          <div className="px-3 py-1.5 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-semibold text-slate-200">
              <Layers className="w-3.5 h-3.5 text-sky-400" />
              <span>Diagram Configuration Presets</span>
            </div>
            <span className="text-[10px] text-slate-400">
              {userPresets.length} Custom · {BUILTIN_PRESETS.length} Built-in
            </span>
          </div>

          {/* User Presets Section */}
          <div className="py-1">
            <div className="px-3 py-1 text-[10px] font-semibold text-sky-400 tracking-wider uppercase flex items-center justify-between">
              <span>My User Presets</span>
              <button
                type="button"
                onClick={() => handleOpenSaveDialog()}
                className="text-sky-400 hover:text-sky-200 flex items-center gap-0.5 lowercase text-[10px] font-normal"
              >
                <Plus className="w-2.5 h-2.5" />
                <span>new</span>
              </button>
            </div>

            {userPresets.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-slate-500 italic">
                No user presets yet. Tweak engine, curve, theme, or priorities and click &quot;Save Current as Preset&quot; below.
              </div>
            ) : (
              <div className="space-y-0.5 px-1">
                {userPresets.map((preset) => {
                  const isSelected = activePresetId === preset.id;
                  const isMatch = optionsMatchPreset(preset, currentOptions);
                  return (
                    <div
                      key={preset.id}
                      onClick={() => handleSelectPreset(preset)}
                      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-sky-950/70 border border-sky-800/60 text-white'
                          : 'hover:bg-slate-800/70 text-slate-300'
                      }`}
                      role="menuitem"
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium truncate text-[11px]">{preset.name}</span>
                          {isMatch && (
                            <span className="flex items-center text-emerald-400 shrink-0" title="Active & Exact match">
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                          {isSelected && !isMatch && (
                            <span
                              className="text-[9px] text-amber-400 bg-amber-950/70 border border-amber-800/60 px-1 py-0.2 rounded shrink-0"
                              title="Modified from preset settings"
                            >
                              modified
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">
                          {preset.layoutEngine.toUpperCase()} · {preset.flowchartCurve} · {preset.mermaidTheme} · {getPriorityDisplay(preset.priorityFormat)}
                        </div>
                      </div>

                      {/* User Preset Quick Actions */}
                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 shrink-0">
                        {isSelected && !isMatch && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOverwriteCurrentPreset(preset);
                            }}
                            className="p-1 hover:text-sky-300 text-slate-400 hover:bg-slate-700/60 rounded"
                            title="Overwrite this preset with current settings"
                          >
                            <Save className="w-3 h-3 text-amber-400" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenSaveDialog(preset);
                          }}
                          className="p-1 hover:text-sky-300 text-slate-400 hover:bg-slate-700/60 rounded"
                          title="Rename / update preset"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeletePreset(preset.id, e)}
                          className="p-1 hover:text-rose-400 text-slate-400 hover:bg-slate-700/60 rounded"
                          title="Delete user preset"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="h-px bg-slate-800/80 my-1" />

          {/* Built-in Presets Section */}
          <div className="py-1">
            <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 tracking-wider uppercase">
              Factory Presets
            </div>
            <div className="space-y-0.5 px-1">
              {BUILTIN_PRESETS.map((preset) => {
                const isSelected = activePresetId === preset.id;
                const isMatch = optionsMatchPreset(preset, currentOptions);
                return (
                  <div
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset)}
                    className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-slate-800/90 border border-slate-700 text-white'
                        : 'hover:bg-slate-800/50 text-slate-300'
                    }`}
                    role="menuitem"
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate text-[11px]">{preset.name}</span>
                        {isMatch && (
                          <span className="flex items-center text-emerald-400 shrink-0" title="Active match">
                            <Check className="w-3 h-3" />
                          </span>
                        )}
                        {isSelected && !isMatch && (
                          <span
                            className="text-[9px] text-amber-400 bg-amber-950/70 border border-amber-800/60 px-1 py-0.2 rounded shrink-0"
                            title="Modified from preset settings"
                          >
                            modified
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        {preset.layoutEngine.toUpperCase()} · {preset.flowchartCurve} · {preset.mermaidTheme} · {getPriorityDisplay(preset.priorityFormat)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="h-px bg-slate-800/80 my-1" />

          {/* Footer Action */}
          <div className="p-1.5">
            <button
              id="save-preset-dropdown-footer-btn"
              type="button"
              onClick={() => handleOpenSaveDialog()}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-600/40 rounded-lg text-[11px] font-medium transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Current Settings as User Preset...</span>
            </button>
          </div>
        </div>
      )}

      {/* Save Preset Modal Dialog */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div
            id="save-preset-modal-content"
            className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-md overflow-hidden text-slate-200"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-preset-dialog-title"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/70">
              <div className="flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-sky-400" />
                <h3 id="save-preset-dialog-title" className="text-sm font-semibold text-white">
                  {editingPresetId ? 'Edit / Overwrite Preset' : 'Save as User Preset'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSaveModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-md transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSavePresetSubmit} className="p-4 space-y-4">
              <div>
                <label htmlFor="preset-name-input" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Preset Name
                </label>
                <input
                  id="preset-name-input"
                  ref={inputRef}
                  type="text"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  placeholder="e.g. Presentation High-Res, Dark Orthogonal..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                  maxLength={50}
                  required
                />
              </div>

              {/* Options to be saved preview */}
              <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 text-xs space-y-2">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Options saved in this preset:
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="flex items-center justify-between p-1.5 bg-slate-900/60 rounded border border-slate-800">
                    <span className="text-slate-400">Layout Engine:</span>
                    <span className="font-semibold text-sky-300 uppercase">
                      {currentOptions.layoutEngine}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 bg-slate-900/60 rounded border border-slate-800">
                    <span className="text-slate-400">Curve:</span>
                    <span className="font-semibold text-sky-300">
                      {currentOptions.flowchartCurve}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 bg-slate-900/60 rounded border border-slate-800">
                    <span className="text-slate-400">Theme:</span>
                    <span className="font-semibold text-sky-300">
                      {currentOptions.mermaidTheme}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 bg-slate-900/60 rounded border border-slate-800">
                    <span className="text-slate-400">Priorities:</span>
                    <span className="font-semibold text-sky-300">
                      {getPriorityDisplay(currentOptions.priorityFormat)}
                    </span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 leading-tight">
                  This preset is saved to your browser&apos;s localStorage and can be recalled anytime with one click.
                </p>
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSaveModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  id="confirm-save-preset-btn"
                  type="submit"
                  disabled={!newPresetName.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 transition-colors disabled:opacity-50 shadow-sm"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{editingPresetId ? 'Update Preset' : 'Save Preset'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
