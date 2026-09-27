import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Server, X } from 'lucide-react';
import { MachineOverview, overviewWatchId } from './MachineOverview.tsx';
import { SideConnection, type SidePlc, type SideStatus, type SideVia } from '../utils/sideLive.ts';
import type { LiveValue } from '../utils/liveGuards.ts';
import type { SymbolChild } from '../utils/xaeHost.ts';

/**
 * Machine Overview for several machines at once: other PLCs next to the POU's own, each with its own monitor
 * connection and overview (its machines, states, time in state, stuck and error states). The chosen PLCs are kept
 * in this app and connect again when the tab opens.
 */

const STORE = 'kss.overview.plcs';

function loadChosen(): SidePlc[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) || '[]') as SidePlc[];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.key === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

const saveChosen = (list: SidePlc[]) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
  } catch {
    // per-viewer convenience only
  }
};

interface OtherPlcsOverviewProps {
  /** How the other PLCs are reached (null: not in this edition) */
  via: SideVia | null;
  /** The PLCs that can be added (remembered ones, or the gateway's) */
  candidates: SidePlc[];
  stateVar: string;
  pouTypeName?: string;
  pouStateNames?: Map<number, string>;
  /** Watch: a machine of that PLC in its own tab / window, live */
  onWatch: (machine: SymbolChild, plc: SidePlc) => void;
  openTarget: 'tab' | 'window';
}

const OnePlc: React.FC<{ plc: SidePlc; via: SideVia; onRemove: () => void } & Omit<OtherPlcsOverviewProps, 'via' | 'candidates'>> = ({ plc, via, onRemove, stateVar, pouTypeName, pouStateNames, onWatch, openTarget }) => {
  const [status, setStatus] = useState<SideStatus>({ state: 'connecting' });
  const [values, setValues] = useState<Record<string, LiveValue>>({});
  const [root, setRoot] = useState('MAIN.mainStateMachine');
  const conn = useRef<SideConnection | null>(null);
  useEffect(() => {
    const c = new SideConnection(plc, via, setStatus, (vals) =>
      setValues((prev) => {
        const next = { ...prev };
        for (const s of vals) {
          if (s.v === null || s.v === undefined) delete next[s.id];
          else next[s.id] = s.v;
        }
        return next;
      })
    );
    conn.current = c;
    c.start();
    return () => {
      c.close();
      conn.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plc.key]);
  const browse = useCallback((path: string) => conn.current?.browse(path, stateVar) ?? Promise.resolve({ requestId: 0, path, error: 'Not connected' }), [stateVar]);
  const follow = useCallback(
    (paths: string[]) => conn.current?.watch(paths.map((p) => ({ id: overviewWatchId(p), candidates: [`${p}.${stateVar}`] }))),
    [stateVar]
  );
  const color = status.state === 'connected' ? 'text-emerald-300' : status.state === 'connecting' ? 'text-sky-300' : 'text-rose-300';
  return (
    <section className="other-plc border-t-4 border-slate-800 flex flex-col min-h-[18rem]" data-plc={plc.key}>
      <div className="flex items-center gap-2 px-3 py-1 bg-slate-900 border-b border-slate-800 text-xs">
        <Server className="w-3.5 h-3.5 text-violet-300" />
        <span className="font-semibold text-slate-200">{plc.name}</span>
        <span className={`other-plc-status truncate ${color}`} title={status.message}>
          {status.message || status.state}
        </span>
        <button className="other-plc-remove ml-auto p-0.5 rounded text-slate-500 hover:text-rose-300 hover:bg-slate-800" onClick={onRemove} title="Remove this PLC from the overview">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <MachineOverview
        connected={status.state === 'connected'}
        root={root}
        onRootChange={setRoot}
        browse={browse}
        values={values}
        onFollow={follow}
        stateVar={stateVar}
        pouTypeName={pouTypeName}
        pouStateNames={pouStateNames}
        onWatch={(m) => onWatch(m, plc)}
        openTarget={openTarget}
        idSuffix={`-${plc.key}`}
        plcName={plc.name}
      />
    </section>
  );
};

export const OtherPlcsOverview: React.FC<OtherPlcsOverviewProps> = ({ via, candidates, ...rest }) => {
  const [chosen, setChosen] = useState<SidePlc[]>(loadChosen);
  const [pick, setPick] = useState('');
  const addable = useMemo(() => candidates.filter((c) => !chosen.some((p) => p.key === c.key)), [candidates, chosen]);
  const update = (list: SidePlc[]) => {
    setChosen(list);
    saveChosen(list);
  };
  if (!via) return null;
  return (
    <div id="other-plcs" className="shrink-0 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-slate-800 bg-slate-950 text-xs">
        <span className="text-slate-400">Other PLCs</span>
        {addable.length > 0 ? (
          <>
            <select id="other-plcs-pick" value={pick} onChange={(e) => setPick(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-200">
              <option value="">Choose a PLC...</option>
              {addable.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              id="other-plcs-add"
              disabled={!pick}
              onClick={() => {
                const c = addable.find((x) => x.key === pick);
                if (c) update([...chosen, c]);
                setPick('');
              }}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:text-sky-300 hover:bg-slate-800 disabled:opacity-40"
              title="Show this PLC's machines too"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </>
        ) : (
          <span className="text-slate-500">{candidates.length ? 'All are shown' : 'Remember PLCs in the Live tab (or use a gateway) to add them here'}</span>
        )}
      </div>
      {chosen.map((p) => (
        <OnePlc key={p.key} plc={p} via={via} onRemove={() => update(chosen.filter((x) => x.key !== p.key))} {...rest} />
      ))}
    </div>
  );
};
