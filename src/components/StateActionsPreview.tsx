import React from 'react';
import { highlightStructuredText } from '../utils/stSyntaxHighlighter.ts';

/**
 * A state's code on hover (its CASE branch, as written): Structured Text highlighted, each line on one line (cut, not
 * wrapped), the names the Problems tab flags in the state's code underlined, and those problems listed
 */
export const StateActionsPreview: React.FC<{ text: string; problems?: { messages: string[]; names: string[] } }> = ({ text, problems }) => {
  const names = (problems?.names ?? []).filter((n) => /^[A-Za-z_]\w*$/.test(n));
  const mark = (html: string) =>
    names.reduce((h, n) => h.replace(new RegExp(`(?<![\\w-])(${n})(?![\\w-])(?![^<]*>)`, 'gi'), '<span class="st-lint-name">$1</span>'), html);
  return (
    <div className="state-actions-preview font-mono text-[10.5px] leading-[15px]">
      <div className="prism-code">
        {text.split('\n').map((line, i) =>
          /^\s/.test(line) ? (
            <div key={i} className="whitespace-pre overflow-hidden text-slate-200 pl-2" dangerouslySetInnerHTML={{ __html: mark(highlightStructuredText(line.replace(/^ {2}/, ''))) || '&nbsp;' }} />
          ) : (
            <div key={i} className="whitespace-pre overflow-hidden text-[10px] font-sans text-slate-500 mt-0.5">
              {line}
            </div>
          )
        )}
      </div>
      {problems && problems.messages.length > 0 && (
        <div className="state-actions-problems mt-1 pt-1 border-t border-slate-700/70 space-y-0.5 font-sans">
          {problems.messages.slice(0, 6).map((m, i) => (
            <div key={i} className="whitespace-pre overflow-hidden text-amber-300 text-[10px]">
              ⚠ {m}
            </div>
          ))}
          {problems.messages.length > 6 && <div className="text-slate-500 text-[10px]">… {problems.messages.length - 6} more (Problems tab)</div>}
        </div>
      )}
    </div>
  );
};
