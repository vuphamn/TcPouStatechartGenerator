import React, { useRef, useState } from 'react';
import {
  MoreHorizontal,
  ChevronDown,
  Printer,
  ExternalLink,
  Loader2,
  Copy,
  Download,
  Sparkles,
  Play,
  Bookmark,
  FolderOpen,
  FolderSearch,
  ListTree,
} from 'lucide-react';
import { DockMenu, DockMenuItem } from './dock/DockMenu.tsx';

/** Header actions; the ones that do not fit on the header row are listed in this menu */
export type HeaderItemId = 'source' | 'sample' | 'generate' | 'copy' | 'download' | 'export' | 'pdf' | 'mermaidLive';

export interface HeaderHiddenControlsProps {
  /** Header actions that overflowed the header row; only these are shown in the menu */
  overflowItems: HeaderItemId[];
  /** Narrow header: show only the icon and count */
  compact?: boolean;
  samples: { id: string; title: string }[];
  pouFileName: string;
  dutFileName: string;
  onBrowsePou: () => void;
  /** Set while the state enum still has to be found */
  onFindDut?: () => void;
  selectedSampleId: string;
  onSelectSample: (sampleId: string) => void;
  onGenerate: () => void;
  onCopyMarkdown: () => void;
  onDownload: () => void;
  onOpenExportDialog: () => void;
  onExportWithPreset: () => void;
  exportPresetLabel: string;
  onPrintToPdf: () => void;
  isPrintingPdf: boolean;
  onOpenMermaidLive: () => void;
  hasOutput: boolean;
}

export const HeaderHiddenControls: React.FC<HeaderHiddenControlsProps> = ({
  overflowItems,
  compact = false,
  samples,
  pouFileName,
  dutFileName,
  onBrowsePou,
  onFindDut,
  selectedSampleId,
  onSelectSample,
  onGenerate,
  onCopyMarkdown,
  onDownload,
  onOpenExportDialog,
  onExportWithPreset,
  exportPresetLabel,
  onPrintToPdf,
  isPrintingPdf,
  onOpenMermaidLive,
  hasOutput,
}) => {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const closedAtRef = useRef<number>(0);
  const has = (id: HeaderItemId) => overflowItems.includes(id);
  const hiddenCount = overflowItems.length;

  const items: DockMenuItem[] = [];
  const actions: DockMenuItem[] = [];
  if (has('source')) {
    items.push(
      { id: 'heading-source', heading: true, label: 'Function Block' },
      { id: 'header-browse-pou', label: 'Browse .TcPOU...', hint: pouFileName || undefined, icon: <FolderOpen className="w-3.5 h-3.5" />, onSelect: onBrowsePou },
      onFindDut
        ? { id: 'header-find-dut', label: 'Find .TcDUT...', icon: <FolderSearch className="w-3.5 h-3.5" />, onSelect: onFindDut }
        : { id: 'header-dut-info', label: `Enum: ${dutFileName || '-'}`, icon: <ListTree className="w-3.5 h-3.5" />, disabled: true },
      { id: 'sep-source', separator: true }
    );
  }
  if (has('generate')) {
    actions.push({ id: 'header-generate', label: 'Generate', icon: <Play className="w-3.5 h-3.5" />, onSelect: onGenerate });
  }
  if (has('copy')) {
    actions.push({ id: 'header-copy', label: 'Copy Markdown', icon: <Copy className="w-3.5 h-3.5" />, disabled: !hasOutput, onSelect: onCopyMarkdown });
  }
  if (has('download')) {
    actions.push({ id: 'header-download', label: 'Download .statechart.md', icon: <Download className="w-3.5 h-3.5" />, disabled: !hasOutput, onSelect: onDownload });
  }
  if (has('export')) {
    actions.push(
      { id: 'header-export', label: 'High-Res Export Dialog...', icon: <Sparkles className="w-3.5 h-3.5" />, disabled: !hasOutput, onSelect: onOpenExportDialog },
      { id: 'header-export-preset', label: 'Export with Preset', hint: exportPresetLabel, icon: <Bookmark className="w-3.5 h-3.5" />, disabled: !hasOutput, onSelect: onExportWithPreset }
    );
  }
  if (has('pdf')) {
    actions.push({
      id: 'header-pdf',
      label: isPrintingPdf ? 'Generating PDF...' : 'Print to PDF',
      hint: 'Visible area',
      icon: isPrintingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />,
      disabled: !hasOutput || isPrintingPdf,
      onSelect: onPrintToPdf,
    });
  }
  if (has('mermaidLive')) {
    actions.push({ id: 'header-mermaid-live', label: 'Open in Mermaid Live', icon: <ExternalLink className="w-3.5 h-3.5" />, disabled: !hasOutput, onSelect: onOpenMermaidLive });
  }
  if (actions.length > 0) items.push({ id: 'heading-actions', heading: true, label: 'Actions' }, ...actions);
  if (has('sample')) {
    if (items.length > 0) items.push({ id: 'sep-sample', separator: true });
    items.push(
      { id: 'heading-sample', heading: true, label: 'Sample' },
      ...samples.map((s) => ({
        id: `header-sample-${s.id}`,
        label: s.title,
        checked: s.id === selectedSampleId,
        onSelect: () => onSelectSample(s.id),
      }))
    );
  }

  return (
    <div className="inline-flex items-center shrink-0" id="header-hidden-controls-container">
      <button
        id="header-hidden-controls-btn"
        type="button"
        onClick={(e) => {
          // The menu's outside-click handler already closed it when this button was pressed
          if (Date.now() - closedAtRef.current < 250) return;
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { x: r.right - 240, y: r.bottom + 6 });
        }}
        className={`flex items-center gap-1.5 ${compact ? 'px-1.5' : 'px-2.5'} py-1 sm:py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
          anchor
            ? 'bg-amber-500/25 text-amber-300 border border-amber-500/70 shadow-sm ring-1 ring-amber-500/40'
            : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 hover:text-amber-200 border border-amber-500/40 shadow-xs'
        }`}
        title={`${hiddenCount} header action${hiddenCount === 1 ? '' : 's'} that do not fit in the header`}
        aria-label="Hidden header actions menu"
        aria-expanded={Boolean(anchor)}
      >
        <MoreHorizontal className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        {!compact && <span>Hidden</span>}
        <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-mono font-bold text-[10px] leading-tight">
          {hiddenCount}
        </span>
        <ChevronDown className={`w-3 h-3 text-amber-400/80 transition-transform duration-200 shrink-0 ${anchor ? 'rotate-180' : ''}`} />
      </button>
      {anchor && (
        <DockMenu
          id="header-hidden-controls-menu"
          x={anchor.x}
          y={anchor.y}
          items={items}
          onClose={() => {
            setAnchor(null);
            closedAtRef.current = Date.now();
          }}
        />
      )}
    </div>
  );
};
