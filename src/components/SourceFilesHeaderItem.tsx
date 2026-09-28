import React, { useRef, useState } from 'react';
import { FileCode2, FolderOpen, FolderSearch, ListTree, ChevronDown, AlertTriangle, FileUp, Save, SaveAll } from 'lucide-react';
import { usePendingEditors } from '../utils/pendingSaves.ts';
import { DockMenu, DockMenuItem } from './dock/DockMenu.tsx';
import { DutMatch } from '../utils/dutMatcher.ts';

/**
 * How the enum (.TcDUT) of the loaded function block was obtained:
 * sample = bundled sample, found = matched in the .TcPOU's folder, none = searched but no enum matched,
 * pending = the folder has not been searched yet (web: needs the user to grant folder access)
 */
export type DutSearchStatus = 'sample' | 'found' | 'none' | 'pending';

export interface SourceFilesHeaderItemProps {
  pouFileName: string;
  /** Full path, shown as tooltip (desktop app) */
  pouPath?: string;
  dutFileName: string;
  /** Path of the chosen enum relative to the .TcPOU folder (tells same-named files apart) */
  dutRelativePath?: string;
  dutMatches: DutMatch[] | null;
  dutStatus: DutSearchStatus;
  /** The folder can be searched from here (desktop, or a browser with folder access) */
  canSearchFolder: boolean;
  onBrowsePou: () => void;
  /** A .TcPOU dropped here, with its file handle when the browser gives one (it can be written back) */
  onDropPou: (file: File, handle?: Promise<unknown>) => void;
  onFindDut: () => void;
  onChooseDutFiles: () => void;
  onSelectDut: (match: DutMatch) => void;
  /** Write the edited .TcPOU / .TcDUT back (XAE: into the project; desktop / web: to the files), with a menu */
  hostSave?: { dirtyCount: number; onSave: () => void;
    /** Save (the editor used last) / Save All (every editor): their edits into the POU, then the files written */
    onSaveEditor?: (which: 'active' | 'all') => void; id?: string; label?: string; title?: string; menu?: DockMenuItem[] };
  /** TwinCAT XAE extension: a file with unsaved edits here was changed in XAE */
  hostConflict?: { name: string; onReload: () => void; onKeepMine: () => void };
}

/** Header toolbar entry for the TwinCAT source: the function block file and the state enum found for it */
/** The header's Save and Save All icons: an editor's edits (the one used last / all of them) into the POU, then the files */
const HeaderSaveIcons: React.FC<{ onSaveEditor: (which: 'active' | 'all') => void; fileCount: number }> = ({ onSaveEditor, fileCount }) => {
  const editors = usePendingEditors();
  const active = editors.find((e) => e.active) ?? editors[0];
  const files = fileCount > 0 ? `${fileCount} file${fileCount === 1 ? '' : 's'}` : '';
  const btn = (on: boolean) => `p-1 rounded-md ${on ? 'text-sky-300 hover:text-white hover:bg-slate-800' : 'text-slate-600 cursor-default'}`;
  const canSave = !!active || fileCount > 0;
  // (always: the app's other windows may have edits to save)
  const canAll = true;
  const hereToSave = editors.length > 0 || fileCount > 0;
  return (
    <>
      <button
        id="header-save-btn"
        type="button"
        disabled={!canSave}
        onClick={() => onSaveEditor('active')}
        className={btn(canSave)}
        title={canSave ? `Save (Ctrl+S): ${[active ? `${active.label}'s edits into the POU` : '', files ? `the ${files} written` : 'then the files written'].filter(Boolean).join(', ')}` : 'Save: nothing to save'}
      >
        <Save className="w-3.5 h-3.5" />
      </button>
      <button
        id="header-save-all-btn"
        type="button"
        disabled={!canAll}
        onClick={() => onSaveEditor('all')}
        className={`relative ${btn(canAll)}`}
        title={`Save All: ${hereToSave ? `${editors.length ? `the edits of ${editors.map((e) => e.label).join(', ')} into the POU, ` : ''}the files written, ` : 'nothing to save here; '}and the app's other windows save theirs`}
      >
        <SaveAll className="w-3.5 h-3.5" />
        {editors.length > 0 && <span id="header-save-all-count" className="absolute -top-0.5 -right-0.5 min-w-[12px] h-3 px-0.5 rounded-full bg-amber-500 text-[8px] leading-3 font-bold text-slate-950 text-center">{editors.length}</span>}
      </button>
    </>
  );
};

export const SourceFilesHeaderItem: React.FC<SourceFilesHeaderItemProps> = ({
  pouFileName,
  pouPath,
  dutFileName,
  dutRelativePath,
  dutMatches,
  dutStatus,
  canSearchFolder,
  onBrowsePou,
  onDropPou,
  onFindDut,
  onChooseDutFiles,
  onSelectDut,
  hostSave,
  hostConflict,
}) => {
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [saveMenuAnchor, setSaveMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const closedAtRef = useRef(0);

  const best = dutMatches?.[0];
  const current = dutMatches?.find((m) => m.relativePath === dutRelativePath) ?? null;
  const matchHint = (m: DutMatch) => `${m.matched}/${m.caseStates} states`;

  const menuItems: DockMenuItem[] = [];
  if (dutMatches && dutMatches.length > 0) {
    menuItems.push({ id: 'dut-heading', heading: true, label: `Matching enums (${dutMatches.length})` });
    dutMatches.forEach((m, i) =>
      menuItems.push({
        id: `dut-match-${i}`,
        label: m.relativePath,
        hint: matchHint(m),
        checked: m.relativePath === dutRelativePath,
        onSelect: () => onSelectDut(m),
      })
    );
    menuItems.push({ id: 'dut-sep', separator: true });
  }
  if (canSearchFolder) {
    menuItems.push({
      id: 'dut-search-folder',
      label: dutStatus === 'pending' ? 'Search the .TcPOU folder...' : 'Search the folder again...',
      icon: <FolderSearch className="w-3.5 h-3.5" />,
      onSelect: onFindDut,
    });
  }
  menuItems.push({ id: 'dut-choose-files', label: 'Choose .TcDUT file(s)...', icon: <FileUp className="w-3.5 h-3.5" />, onSelect: onChooseDutFiles });

  const openMenu = (e: React.MouseEvent<HTMLElement>) => {
    if (Date.now() - closedAtRef.current < 250) return;
    const r = e.currentTarget.getBoundingClientRect();
    setMenuAnchor(menuAnchor ? null : { x: r.left, y: r.bottom + 6 });
  };

  let enumChip: React.ReactNode;
  if (dutStatus === 'pending') {
    enumChip = (
      <button
        id="tcdut-find-btn"
        type="button"
        onClick={canSearchFolder ? onFindDut : onChooseDutFiles}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/50 text-[11px] font-semibold whitespace-nowrap transition-colors"
        title={
          canSearchFolder
            ? "Find the enum: allow read access to the .TcPOU's folder; it and its subfolders are searched for the .TcDUT that declares the doState() states"
            : 'Choose the .TcDUT file(s) with the state enum (this browser cannot search folders)'
        }
      >
        <FolderSearch className="w-3 h-3 shrink-0" />
        Find .TcDUT...
      </button>
    );
  } else if (dutStatus === 'none') {
    enumChip = (
      <button
        id="tcdut-match-btn"
        type="button"
        onClick={openMenu}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/50 text-[11px] font-semibold whitespace-nowrap transition-colors"
        title="No .TcDUT in the .TcPOU's folder (or its subfolders) declares the doState() states"
      >
        <AlertTriangle className="w-3 h-3 shrink-0" />
        No matching .TcDUT
        <ChevronDown className="w-3 h-3 shrink-0" />
      </button>
    );
  } else {
    const shown = current ?? best;
    enumChip = (
      <button
        id="tcdut-match-btn"
        type="button"
        onClick={openMenu}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-900/70 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] whitespace-nowrap transition-colors min-w-0"
        title={
          shown
            ? `State enum: ${shown.relativePath}\n${shown.matched} of ${shown.caseStates} doState() states declared` +
              (dutMatches && dutMatches.length > 1 ? `\n${dutMatches.length} matching .TcDUT files: click to choose` : '')
            : `State enum: ${dutFileName}`
        }
      >
        <ListTree className="w-3 h-3 text-sky-400 shrink-0" />
        <span className="font-mono truncate max-w-[150px]">{dutFileName || 'Enum'}</span>
        {dutMatches && dutMatches.length > 1 && (
          <span className="px-1 rounded bg-sky-500/20 text-sky-300 text-[9px] font-bold">{dutMatches.length}</span>
        )}
        <ChevronDown className="w-3 h-3 shrink-0 text-slate-500" />
      </button>
    );
  }

  return (
    <div
      id="source-files-header"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.items).some((i) => i.kind === 'file')) {
          e.preventDefault();
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = Array.from(e.dataTransfer.files).find((f) => /\.tcpou$/i.test(f.name));
        // (the handle is only given during the drop)
        const item = Array.from(e.dataTransfer.items ?? []).find((i) => i.kind === 'file' && /\.tcpou$/i.test(i.getAsFile()?.name ?? ''));
        const handle = (item as unknown as { getAsFileSystemHandle?: () => Promise<unknown> } | undefined)?.getAsFileSystemHandle?.();
        if (file) onDropPou(file, handle);
      }}
      className={`flex items-center whitespace-nowrap gap-1.5 bg-slate-800/80 border rounded-lg px-1.5 sm:px-2 py-1 text-xs shrink-0 transition-colors ${
        isDragOver ? 'border-sky-400 bg-sky-900/40' : 'border-slate-700/60'
      }`}
    >
      <FileCode2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      <span className="text-slate-400 text-[11px] font-medium shrink-0">Function Block:</span>
      <button
        id="tcpou-choose-file-btn"
        type="button"
        onClick={onBrowsePou}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-600/80 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors shrink-0"
        title="Browse for a .TcPOU file (or drop one here). Its folder and subfolders are searched for the .TcDUT state enum"
      >
        <FolderOpen className="w-3 h-3" />
        Browse
      </button>
      <span
        id="tcpou-file-name"
        className="font-mono text-slate-200 text-[11px] truncate max-w-[180px]"
        title={pouPath || pouFileName}
      >
        {pouFileName || 'No file loaded'}
      </span>
      {(pouFileName || dutStatus !== 'sample') && enumChip}
      {hostConflict && (
        <div
          id="xae-conflict"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/60 text-amber-200 text-[11px] whitespace-nowrap"
          title={`${hostConflict.name} was changed in XAE while you have unsaved edits of it here`}
        >
          <AlertTriangle className="w-3 h-3 shrink-0 text-amber-400" />
          <span className="font-semibold">Changed in XAE</span>
          <button
            id="xae-conflict-reload-btn"
            type="button"
            onClick={hostConflict.onReload}
            className="px-1.5 rounded bg-amber-500/25 hover:bg-amber-500/40 text-amber-100 font-semibold"
            title="Take XAE's version and discard your edits of this file"
          >
            Reload
          </button>
          <button
            id="xae-conflict-keep-btn"
            type="button"
            onClick={hostConflict.onKeepMine}
            className="px-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
            title="Keep your edits; Save to project will overwrite the change made in XAE"
          >
            Keep mine
          </button>
        </div>
      )}
      {hostSave && (
        <>
        <button
          id={hostSave.id ?? 'xae-save-to-project-btn'}
          type="button"
          onClick={hostSave.onSave}
          disabled={hostSave.dirtyCount === 0}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors ${
            hostSave.dirtyCount > 0
              ? 'bg-sky-600 hover:bg-sky-500 text-white'
              : 'bg-slate-900/70 text-slate-500 border border-slate-700 cursor-default'
          }`}
          title={
            hostSave.dirtyCount > 0
              ? hostSave.title ?? `Write ${hostSave.dirtyCount === 1 ? 'the edited file' : 'both edited files'} back into the TwinCAT project (a backup is kept)`
              : 'No unsaved edits'
          }
        >
          <Save className="w-3 h-3 shrink-0" />
          {hostSave.label ?? 'Save to project'}
          {hostSave.dirtyCount > 0 ? ` (${hostSave.dirtyCount})` : ''}
        </button>
        {hostSave.onSaveEditor && (
          <HeaderSaveIcons onSaveEditor={hostSave.onSaveEditor} fileCount={hostSave.dirtyCount} />
        )}
        {hostSave.menu && hostSave.menu.length > 0 && (
          <button
            id="save-sources-menu-btn"
            type="button"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setSaveMenuAnchor({ x: r.left, y: r.bottom + 4 });
            }}
            className="px-0.5 py-0.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800"
            title="Save As / Download"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        )}
        </>
      )}
      {saveMenuAnchor && hostSave?.menu && (
        <DockMenu id="save-sources-menu" x={saveMenuAnchor.x} y={saveMenuAnchor.y} items={hostSave.menu} onClose={() => setSaveMenuAnchor(null)} />
      )}
      {menuAnchor && (
        <DockMenu
          id="tcdut-match-menu"
          x={menuAnchor.x}
          y={menuAnchor.y}
          items={menuItems}
          onClose={() => {
            setMenuAnchor(null);
            closedAtRef.current = Date.now();
          }}
        />
      )}
    </div>
  );
};
