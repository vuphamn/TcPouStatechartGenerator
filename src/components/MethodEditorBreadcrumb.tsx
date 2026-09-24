import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  FileCode,
  FolderGit2,
  Code2,
  ChevronRight,
  ChevronDown,
  Layers,
  Copy,
  Check,
  Search,
  Tag,
  Boxes,
  ExternalLink,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { FoldableBlock } from '../utils/stCodeFolding.ts';
import { PouHierarchyMetadata } from '../utils/pouHierarchy.ts';

export interface MethodEditorBreadcrumbProps {
  metadata: PouHierarchyMetadata;
  selectedMethod: string;
  onSelectMethod: (methodName: string) => void;
  availableMethods: string[];
  activeStateId?: string | null;
  activeStateLabel?: string;
  caseBranches?: FoldableBlock[];
  onJumpToCaseBranch?: (block: FoldableBlock) => void;
  activeSection?: 'declaration' | 'implementation';
  onToggleSection?: () => void;
  isDeclarationVisible?: boolean;
}

export const MethodEditorBreadcrumb: React.FC<MethodEditorBreadcrumbProps> = ({
  metadata,
  selectedMethod,
  onSelectMethod,
  availableMethods,
  activeStateId,
  activeStateLabel,
  caseBranches = [],
  onJumpToCaseBranch,
  activeSection = 'implementation',
  onToggleSection,
  isDeclarationVisible = true,
}) => {
  const [isMethodDropdownOpen, setIsMethodDropdownOpen] = useState<boolean>(false);
  const [isStateDropdownOpen, setIsStateDropdownOpen] = useState<boolean>(false);
  const [isPouPopoverOpen, setIsPouPopoverOpen] = useState<boolean>(false);
  const [methodSearchQuery, setMethodSearchQuery] = useState<string>('');
  const [stateSearchQuery, setStateSearchQuery] = useState<string>('');
  const [copiedPath, setCopiedPath] = useState<boolean>(false);

  const methodDropdownRef = useRef<HTMLDivElement>(null);
  const stateDropdownRef = useRef<HTMLDivElement>(null);
  const pouPopoverRef = useRef<HTMLDivElement>(null);
  const methodSearchInputRef = useRef<HTMLInputElement>(null);
  const stateSearchInputRef = useRef<HTMLInputElement>(null);

  // Clean method name without ()
  const cleanMethodName = useMemo(() => {
    return selectedMethod.replace(/\(\)$/, '').trim();
  }, [selectedMethod]);

  const methodSig = metadata.methodSignatures[cleanMethodName];

  // Close dropdowns on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (!methodDropdownRef.current?.contains(target)) {
        setIsMethodDropdownOpen(false);
      }
      if (!stateDropdownRef.current?.contains(target)) {
        setIsStateDropdownOpen(false);
      }
      if (!pouPopoverRef.current?.contains(target)) {
        setIsPouPopoverOpen(false);
      }
    };

    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isMethodDropdownOpen) {
      setTimeout(() => methodSearchInputRef.current?.focus(), 50);
    } else {
      setMethodSearchQuery('');
    }
  }, [isMethodDropdownOpen]);

  useEffect(() => {
    if (isStateDropdownOpen) {
      setTimeout(() => stateSearchInputRef.current?.focus(), 50);
    } else {
      setStateSearchQuery('');
    }
  }, [isStateDropdownOpen]);

  // Filtered methods for dropdown
  const filteredMethods = useMemo(() => {
    if (!methodSearchQuery.trim()) return availableMethods;
    const q = methodSearchQuery.toLowerCase();
    return availableMethods.filter((m) => m.toLowerCase().includes(q));
  }, [availableMethods, methodSearchQuery]);

  // Filtered state branches for dropdown
  const filteredCaseBranches = useMemo(() => {
    if (!stateSearchQuery.trim()) return caseBranches;
    const q = stateSearchQuery.toLowerCase();
    return caseBranches.filter(
      (b) => b.label.toLowerCase().includes(q) || b.summary.toLowerCase().includes(q)
    );
  }, [caseBranches, stateSearchQuery]);

  // Fully qualified symbol path e.g. SM_DoorDasher.doState().Init
  const fullSymbolPath = useMemo(() => {
    const base = `${metadata.pouName}.${cleanMethodName}()`;
    if (cleanMethodName.toLowerCase() === 'dostate' && activeStateId) {
      return `${base}.${activeStateLabel || activeStateId}`;
    }
    return base;
  }, [metadata.pouName, cleanMethodName, activeStateId, activeStateLabel]);

  // Copy full symbol path to clipboard
  const handleCopySymbolPath = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(fullSymbolPath);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    } catch {
      // Ignore copy error
    }
  };

  // Determine POU badge color
  const pouBadgeColor =
    metadata.pouTypeShort === 'FB'
      ? 'bg-sky-950 text-sky-300 border-sky-700/70'
      : metadata.pouTypeShort === 'PRG'
      ? 'bg-emerald-950 text-emerald-300 border-emerald-700/70'
      : 'bg-violet-950 text-violet-300 border-violet-700/70';

  return (
    <nav
      id="method-editor-breadcrumb-bar"
      aria-label="POU and Method hierarchy breadcrumb trail"
      className="flex items-center justify-between px-3 py-1.5 bg-slate-950 border-b border-slate-800/90 text-xs select-none min-h-[34px] gap-2 overflow-x-auto custom-scrollbar"
    >
      {/* Left side: Breadcrumb segments */}
      <div className="flex items-center flex-wrap gap-1 min-w-0">
        {/* 1. File Segment */}
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
          title={`TwinCAT POU File: ${metadata.fileName}`}
        >
          <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="font-mono text-[11px] text-slate-300 max-w-[130px] sm:max-w-[170px] truncate">
            {metadata.fileName}
          </span>
        </div>

        <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />

        {/* 2. POU Segment with Popover */}
        <div ref={pouPopoverRef} className="relative flex items-center">
          <button
            type="button"
            onClick={() => setIsPouPopoverOpen(!isPouPopoverOpen)}
            className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-slate-900 transition-colors cursor-pointer group"
            title={`POU: ${metadata.pouName} (${metadata.pouType}) - Click for details`}
          >
            <span
              className={`px-1 py-0.2 rounded font-mono text-[9px] font-bold uppercase border shrink-0 ${pouBadgeColor}`}
            >
              {metadata.pouTypeShort}
            </span>
            <span className="font-semibold text-slate-200 group-hover:text-white truncate max-w-[140px] sm:max-w-[180px]">
              {metadata.pouName}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-500 group-hover:text-slate-300" />
          </button>

          {/* POU Details Popover */}
          {isPouPopoverOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute top-full left-0 mt-1 z-50 w-64 rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl backdrop-blur-md p-3 text-xs text-slate-200 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-100"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                <span className="font-bold text-[11px] text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Boxes className="w-3.5 h-3.5 text-sky-400" />
                  POU Information
                </span>
                <span className={`px-1.5 py-0.2 rounded font-mono text-[9px] font-bold border ${pouBadgeColor}`}>
                  {metadata.pouType}
                </span>
              </div>
              <div className="flex flex-col gap-1 text-[11px] font-mono">
                <div className="flex justify-between text-slate-400">
                  <span>Name:</span>
                  <span className="text-slate-200 font-semibold">{metadata.pouName}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>File:</span>
                  <span className="text-slate-300 truncate max-w-[150px]">{metadata.fileName}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Methods:</span>
                  <span className="text-sky-400">{metadata.allMethods.length} defined</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopySymbolPath}
                className="mt-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-[11px]"
              >
                {copiedPath ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedPath ? 'Copied Symbol Path' : 'Copy Symbol Path'}</span>
              </button>
            </div>
          )}
        </div>

        <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />

        {/* 3. Methods Collection Segment */}
        <div ref={methodDropdownRef} className="relative flex items-center">
          <button
            type="button"
            onClick={() => setIsMethodDropdownOpen(!isMethodDropdownOpen)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-slate-900 transition-colors cursor-pointer text-slate-400 hover:text-slate-200 group"
            title="Browse all methods in this POU"
          >
            <FolderGit2 className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
            <span className="hidden md:inline font-medium text-[11px]">Methods</span>
            <span className="px-1 py-0.2 text-[9px] rounded-full bg-slate-800 text-slate-400 font-mono border border-slate-700/60">
              {availableMethods.length}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-500 group-hover:text-slate-300" />
          </button>

          {/* Methods Quick-Switch Dropdown */}
          {isMethodDropdownOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute top-full left-0 mt-1 z-50 w-72 rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl backdrop-blur-md p-2 text-xs text-slate-200 flex flex-col gap-1.5 animate-in fade-in zoom-in-95 duration-100"
            >
              <div className="flex items-center justify-between pb-1 px-1 border-b border-slate-800 text-[11px] font-semibold text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5 text-sky-400" />
                  Select Method ({availableMethods.length})
                </span>
              </div>

              {/* Filter Search */}
              <div className="relative flex items-center">
                <Search className="w-3 h-3 text-slate-400 absolute left-2 pointer-events-none" />
                <input
                  ref={methodSearchInputRef}
                  type="text"
                  placeholder="Filter methods..."
                  value={methodSearchQuery}
                  onChange={(e) => setMethodSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-sky-500 rounded-md pl-7 pr-2 py-1 text-xs font-mono text-slate-200 outline-none placeholder-slate-500"
                />
              </div>

              {/* Methods List */}
              <div className="max-h-52 overflow-y-auto custom-scrollbar flex flex-col gap-0.5 mt-1">
                {filteredMethods.map((m) => {
                  const clean = m.replace(/\(\)$/, '');
                  const sig = metadata.methodSignatures[clean];
                  const isCurrent = m === selectedMethod;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        onSelectMethod(m);
                        setIsMethodDropdownOpen(false);
                      }}
                      className={`flex items-center justify-between px-2 py-1 rounded text-left font-mono text-xs transition-colors cursor-pointer ${
                        isCurrent
                          ? 'bg-sky-950/90 text-sky-200 font-bold border border-sky-700/60'
                          : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Code2
                          className={`w-3 h-3 shrink-0 ${
                            isCurrent
                              ? 'text-sky-400'
                              : clean.toLowerCase() === 'dostate'
                              ? 'text-amber-400'
                              : 'text-slate-400'
                          }`}
                        />
                        <span className="truncate">{m}</span>
                      </div>
                      {sig?.returnType && (
                        <span className="text-[10px] text-slate-400 font-sans px-1 rounded bg-slate-800/80 border border-slate-700/50 shrink-0 ml-1">
                          :{sig.returnType}
                        </span>
                      )}
                    </button>
                  );
                })}
                {filteredMethods.length === 0 && (
                  <div className="p-3 text-center text-slate-500 text-xs">No matching methods</div>
                )}
              </div>
            </div>
          )}
        </div>

        <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />

        {/* 4. Current Method Segment */}
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-950/60 border border-sky-800/60 text-sky-200">
          <Code2
            className={`w-3.5 h-3.5 shrink-0 ${
              cleanMethodName.toLowerCase() === 'dostate' ? 'text-amber-400' : 'text-sky-400'
            }`}
          />
          <span className="font-mono font-bold text-xs">{selectedMethod}</span>
          {methodSig?.returnType && (
            <span
              className="text-[10px] font-mono text-sky-300 px-1 py-0.2 rounded bg-sky-900/60 border border-sky-700/50"
              title={`Return type: ${methodSig.returnType}`}
            >
              :{methodSig.returnType}
            </span>
          )}
        </div>

        {/* 5. State / Case Branch Segment (Active when inside doState() and case branches exist) */}
        {cleanMethodName.toLowerCase() === 'dostate' && caseBranches.length > 0 && (
          <>
            <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
            <div ref={stateDropdownRef} className="relative flex items-center">
              <button
                type="button"
                onClick={() => setIsStateDropdownOpen(!isStateDropdownOpen)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors cursor-pointer group ${
                  activeStateId
                    ? 'bg-amber-950/70 border border-amber-800/70 text-amber-200'
                    : 'hover:bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
                title="Active State Case Branch - Click to jump between states"
              >
                <Tag className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="font-mono font-medium text-xs max-w-[130px] sm:max-w-[180px] truncate">
                  {activeStateLabel || activeStateId ? (
                    `Case: ${activeStateLabel || activeStateId}`
                  ) : (
                    `States (${caseBranches.length})`
                  )}
                </span>
                <ChevronDown className="w-3 h-3 text-amber-400/80 group-hover:text-amber-300" />
              </button>

              {/* State Case Branches Quick-Jump Dropdown */}
              {isStateDropdownOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-full left-0 mt-1 z-50 w-80 rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl backdrop-blur-md p-2 text-xs text-slate-200 flex flex-col gap-1.5 animate-in fade-in zoom-in-95 duration-100"
                >
                  <div className="flex items-center justify-between pb-1 px-1 border-b border-slate-800 text-[11px] font-semibold text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-amber-400" />
                      Jump to State Branch ({caseBranches.length})
                    </span>
                  </div>

                  {/* Filter Search */}
                  <div className="relative flex items-center">
                    <Search className="w-3 h-3 text-slate-400 absolute left-2 pointer-events-none" />
                    <input
                      ref={stateSearchInputRef}
                      type="text"
                      placeholder="Search state name or case label..."
                      value={stateSearchQuery}
                      onChange={(e) => setStateSearchQuery(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-md pl-7 pr-2 py-1 text-xs font-mono text-slate-200 outline-none placeholder-slate-500"
                    />
                  </div>

                  {/* Case Branches List */}
                  <div className="max-h-56 overflow-y-auto custom-scrollbar flex flex-col gap-0.5 mt-1">
                    {filteredCaseBranches.map((b) => {
                      const isCurrent =
                        activeStateId &&
                        (b.label.includes(activeStateId) || b.summary.includes(activeStateId));
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => {
                            if (onJumpToCaseBranch) {
                              onJumpToCaseBranch(b);
                            }
                            setIsStateDropdownOpen(false);
                          }}
                          className={`flex items-center justify-between px-2 py-1.5 rounded text-left font-mono text-xs transition-colors cursor-pointer ${
                            isCurrent
                              ? 'bg-amber-950/80 text-amber-200 font-bold border border-amber-700/60'
                              : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <ArrowRight
                              className={`w-3 h-3 shrink-0 ${isCurrent ? 'text-amber-400' : 'text-slate-500'}`}
                            />
                            <span className="truncate">{b.label}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-sans px-1 rounded bg-slate-800 border border-slate-700/50 shrink-0 ml-1">
                            Ln {b.startLine}
                          </span>
                        </button>
                      );
                    })}
                    {filteredCaseBranches.length === 0 && (
                      <div className="p-3 text-center text-slate-500 text-xs">No matching state branches</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right side: Symbol path copy & Section toggle indicator */}
      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
        {/* Copy Symbol Path */}
        <button
          type="button"
          onClick={handleCopySymbolPath}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-slate-800 transition-colors cursor-pointer"
          title={`Copy fully-qualified symbol path: ${fullSymbolPath}`}
        >
          {copiedPath ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 text-slate-400" />
              <span className="hidden lg:inline text-slate-400">Copy Path</span>
            </>
          )}
        </button>

        {/* Section View Indicator / Toggle */}
        {onToggleSection && (
          <button
            type="button"
            onClick={onToggleSection}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border ${
              isDeclarationVisible
                ? 'bg-slate-900 text-sky-300 border-slate-700/80 hover:bg-slate-800'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-300'
            }`}
            title="Toggle top declaration panel"
          >
            <Layers className="w-3 h-3 text-sky-400" />
            <span className="hidden xl:inline">Top Panel:</span>
            <span>{isDeclarationVisible ? 'Decl + Impl' : 'Impl Only'}</span>
          </button>
        )}
      </div>
    </nav>
  );
};
