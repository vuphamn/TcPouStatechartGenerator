import React from 'react';
import { HardDriveDownload } from 'lucide-react';

/** The app writes the files: the editor used last (this one: its button clicked) has its edits put in first */
export const SAVE_TO_FILE_EVENT = 'kss-save-to-file';
export const requestSaveToFile = () => window.dispatchEvent(new CustomEvent(SAVE_TO_FILE_EVENT));

/**
 * An editor's "Save to file": its edits put into the POU (or the enum), then the files written, in one step (as the
 * header's Save, for this editor; Ctrl+Alt+S)
 */
export const SaveToFileButton: React.FC<{ id: string; what: string }> = ({ id, what }) => (
  <button
    type="button"
    id={id}
    onClick={requestSaveToFile}
    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors"
    title={`Put this editor's edits into ${what} and write the files, in one step (Ctrl+Alt+S)`}
  >
    <HardDriveDownload className="w-3.5 h-3.5" />
    <span>Save to file</span>
  </button>
);
