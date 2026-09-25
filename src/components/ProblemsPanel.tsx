import React, { useMemo, useState } from 'react';
import { AlertOctagon, AlertTriangle, Info, CheckCircle2, Code2, Wrench, EyeOff, Eye, Crosshair } from 'lucide-react';
import { LINT_RULES, LintFinding, LintSeverity } from '../utils/stateMachineLint.ts';

interface ProblemsPanelProps {
  findings: LintFinding[];
  ignoredKeys: Set<string>;
  onToggleIgnore: (finding: LintFinding) => void;
  onSelectState: (stateId: string) => void;
  /** Opens the code of a finding (TwinCAT's editor in XAE, else the Method Editor) */
  onGoToCode: (finding: LintFinding) => void;
  goToCodeLabel: string;
  onApplyFix: (finding: LintFinding) => void;
}

const SEVERITY: Record<LintSeverity, { icon: React.ReactNode; label: string; chip: string }> = {
  error: {
    icon: <AlertOctagon className="w-3.5 h-3.5 text-rose-400 shrink-0" />,
    label: 'Errors',
    chip: 'bg-rose-950/70 text-rose-300 border-rose-800',
  },
  warning: {
    icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />,
    label: 'Warnings',
    chip: 'bg-amber-950/60 text-amber-300 border-amber-800',
  },
  info: {
    icon: <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />,
    label: 'Info',
    chip: 'bg-sky-950/60 text-sky-300 border-sky-800',
  },
};

const FIX_LABEL: Record<NonNullable<LintFinding['fix']>['kind'], string> = {
  'add-enum-member': 'Add to enum',
  'add-case-branch': 'Add CASE branch',
};

export const ProblemsPanel: React.FC<ProblemsPanelProps> = ({
  findings,
  ignoredKeys,
  onToggleIgnore,
  onSelectState,
  onGoToCode,
  goToCodeLabel,
  onApplyFix,
}) => {
  const [hidden, setHidden] = useState<Set<LintSeverity>>(new Set());
  const [showIgnored, setShowIgnored] = useState(false);

  const active = useMemo(() => findings.filter((f) => !ignoredKeys.has(f.key)), [findings, ignoredKeys]);
  const ignoredCount = findings.length - active.length;
  const counts = useMemo(() => {
    const c: Record<LintSeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const f of active) c[f.severity]++;
    return c;
  }, [active]);
  const shown = (showIgnored ? findings : active).filter((f) => !hidden.has(f.severity));

  const toggle = (s: LintSeverity) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  return (
    <div id="problems-panel" className="flex-1 min-h-0 w-full bg-slate-900 flex flex-col text-xs">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-800 shrink-0 flex-wrap">
        {(['error', 'warning', 'info'] as LintSeverity[]).map((s) => (
          <button
            key={s}
            id={`problems-filter-${s}`}
            onClick={() => toggle(s)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] transition-opacity ${SEVERITY[s].chip} ${
              hidden.has(s) ? 'opacity-40' : ''
            }`}
            title={hidden.has(s) ? `Show ${SEVERITY[s].label.toLowerCase()}` : `Hide ${SEVERITY[s].label.toLowerCase()}`}
          >
            {SEVERITY[s].icon}
            <span className="font-semibold">{counts[s]}</span>
            <span>{SEVERITY[s].label}</span>
          </button>
        ))}
        {ignoredCount > 0 && (
          <button
            id="problems-show-ignored"
            onClick={() => setShowIgnored((v) => !v)}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            title={showIgnored ? 'Hide ignored problems' : 'Show ignored problems'}
          >
            {showIgnored ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {ignoredCount} ignored
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-500">
            <CheckCircle2 className="w-7 h-7 text-emerald-500/70" />
            <span>{active.length === 0 ? 'No problems found' : 'No problems match the filter'}</span>
          </div>
        ) : (
          shown.map((f) => {
            const ignored = ignoredKeys.has(f.key);
            return (
              <div
                key={f.key}
                data-problem-key={f.key}
                className={`group p-2 rounded-lg border bg-slate-800/50 border-slate-700/60 hover:border-slate-600 transition-colors ${
                  ignored ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5">{SEVERITY[f.severity].icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-200" title={LINT_RULES[f.rule].description}>
                        {LINT_RULES[f.rule].title}
                      </span>
                      {f.method && f.line && (
                        <span className="font-mono text-[10px] text-slate-500">
                          {f.method}:{f.line}
                        </span>
                      )}
                    </div>
                    <div className="text-slate-300 break-words">{f.message}</div>
                    {f.text && (
                      <div className="mt-1 font-mono text-[10.5px] text-slate-400 bg-slate-950/60 border border-slate-800 rounded px-1.5 py-0.5 truncate" title={f.text}>
                        {f.text}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-1.5 pl-5 flex-wrap">
                  {f.stateId && (
                    <button
                      onClick={() => onSelectState(f.stateId!)}
                      className="problems-action flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-slate-300 hover:text-sky-300 hover:bg-slate-700/60"
                      title={`Select ${f.stateId} in the diagram`}
                    >
                      <Crosshair className="w-3 h-3" />
                      Show in diagram
                    </button>
                  )}
                  {f.method && f.line && (
                    <button
                      onClick={() => onGoToCode(f)}
                      className="problems-action problems-go-to-code flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-slate-300 hover:text-emerald-300 hover:bg-slate-700/60"
                      title={`${goToCodeLabel}: ${f.method} line ${f.line}`}
                    >
                      <Code2 className="w-3 h-3" />
                      {goToCodeLabel}
                    </button>
                  )}
                  {f.fix && !ignored && (
                    <button
                      onClick={() => onApplyFix(f)}
                      className="problems-action problems-fix flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-amber-200 bg-amber-900/30 hover:bg-amber-800/50"
                      title={`${FIX_LABEL[f.fix.kind]}: ${f.fix.name}`}
                    >
                      <Wrench className="w-3 h-3" />
                      {FIX_LABEL[f.fix.kind]}
                    </button>
                  )}
                  <button
                    onClick={() => onToggleIgnore(f)}
                    className="problems-action problems-ignore ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-slate-500 hover:text-slate-200 hover:bg-slate-700/60"
                    title={ignored ? 'Report this problem again' : 'Ignore this problem in this POU'}
                  >
                    {ignored ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {ignored ? 'Restore' : 'Ignore'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
