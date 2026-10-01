import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, FileText, FolderOpen, ImageOff, Info, ListTree, Search, X } from 'lucide-react';
import type { IoBox, IoDevice } from './IoTreePanel.tsx';
import { stateText, type IoEvent, type SlaveState } from './IoNetworkView.tsx';

/** What the host is asked about a box's device (shared/tcDeviceInfo.cjs) */
export interface DeviceInfoRequest {
  productCode: string;
  revision: string;
  /** Its type, e.g. "EL1008" (the project's ESI type name) */
  type: string;
  /** The name its pictures start with */
  product: string;
}
/** The host's answer: TwinCAT's device description of it (null: not on that computer), the user's pictures of it */
export interface DeviceInfo {
  esi: { type: string; name: string; group: string; vendor: string; url: string; revision: 'same' | 'other'; file: string } | null;
  images: { name: string; dataUrl: string }[];
  folder: string;
  esiDirs?: string[];
  error?: string;
}

/** EtherCAT vendor ids seen in Kval's machines (others: by their number) */
const VENDORS: Record<number, string> = { 0x2: 'Beckhoff Automation', 0x3b: 'Lenze' };
const hex8 = (n: number) => `#x${n.toString(16).padStart(8, '0')}`;
const PORTS = ['A', 'B', 'C', 'D'];

/** The box's type as a word (the ESI type's first, e.g. "EK1200-5000"; else its name's "(…)") */
export const typeOf = (b: IoBox) => (b.info?.type || b.info?.desc || b.product || '').split(/\s+/)[0];

/**
 * Where to read more about a device: Beckhoff's product page (from TwinCAT's device file, else beckhoff.com/<type>,
 * which Beckhoff answers for most types), a search on beckhoff.com (when that page is not there), the manual (PDF);
 * another vendor's: a web search for it
 */
export function deviceLinks(b: IoBox, esiUrl?: string): { kind: 'product' | 'search' | 'manual' | 'web'; label: string; url: string }[] {
  const t = typeOf(b);
  if (!t) return [];
  const beckhoff = b.info?.vendorId === 2 || (b.info?.vendorId === undefined && /^(E[KLPMRSQ]|ELM|ELX|EJ|CX|AX|EPP|ER|KL|BK)\d/i.test(t));
  if (beckhoff) {
    const family = /^[A-Z]+\d+/i.exec(t)?.[0] ?? t;
    return [
      { kind: 'product', label: 'Product page', url: esiUrl || `https://www.beckhoff.com/${t.toLowerCase()}` },
      { kind: 'search', label: 'Search beckhoff.com', url: `https://www.beckhoff.com/en-us/search-results/?q=${encodeURIComponent(t)}` },
      { kind: 'manual', label: 'Manual (PDF)', url: `https://document.beckhoff.com/${family.toLowerCase()}.pdf?target=${family.toLowerCase()}&lang=en-us` },
    ];
  }
  const who = b.info?.supplier || (b.info?.vendorId !== undefined ? VENDORS[b.info.vendorId] : '') || '';
  return [
    ...(esiUrl ? [{ kind: 'product' as const, label: 'Product page', url: esiUrl }] : []),
    { kind: 'web', label: 'Search the web', url: `https://www.google.com/search?q=${encodeURIComponent(`${who} ${b.info?.type || t}`.trim())}` },
  ];
}

const show = (v: unknown) => (v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));

/**
 * A box's properties (the I/O tab; read-only): what the project and TwinCAT's device file say of it, where it is
 * cabled, its state and CRC counters from the master, links to its documentation, the user's own pictures of it, its
 * channels with their linked variables, its recent events
 */
export const IoBoxProperties: React.FC<{
  box: IoBox;
  device: IoDevice;
  parent: IoBox | null;
  state?: SlaveState;
  events: IoEvent[];
  valueOf: (variable: string) => { v: unknown } | undefined;
  /** The host's details (desktop app, Link); absent: only the project's */
  fetchInfo?: (req: DeviceInfoRequest) => Promise<DeviceInfo>;
  onOpenFolder?: () => void;
  onShowInTree: (path: string) => void;
  onClose: () => void;
}> = ({ box, device, parent, state, events, valueOf, fetchInfo, onOpenFolder, onShowInTree, onClose }) => {
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const t = typeOf(box);
  useEffect(() => {
    setInfo(null);
    if (!fetchInfo || !box.info?.productCode) return;
    let live = true;
    setLoading(true);
    fetchInfo({ productCode: box.info.productCode, revision: box.info.revision ?? '', type: box.info.type || t, product: t })
      .then((r) => live && setInfo(r))
      .catch((e: Error) => live && setInfo({ esi: null, images: [], folder: '', error: e.message }))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [box.path, box.info?.productCode, box.info?.revision, box.info?.type, t, fetchInfo]);
  const vendor = info?.esi?.vendor || (box.info?.vendorId !== undefined ? VENDORS[box.info.vendorId] ?? `Vendor ${hex8(box.info.vendorId)}` : '') || box.info?.supplier || '';
  const links = deviceLinks(box, info?.esi?.url);
  const where = box.portA?.master ? `the master (${device.name})` : parent ? `${parent.name.replace(/\s*\([^()]*\)\s*$/, '')}, port ${PORTS[box.portA?.port ?? 1] ?? '?'}` : '—';
  const entries = box.pdos.flatMap((p) => p.entries.map((e) => ({ ...e, pdo: p.name, dir: p.dir })));
  const row = (k: string, v: React.ReactNode, id?: string) =>
    v === '' || v === null || v === undefined ? null : (
      <div className="flex gap-2 py-0.5" data-io-prop={id}>
        <span className="w-28 shrink-0 text-slate-500">{k}</span>
        <span className="min-w-0 break-words text-slate-200">{v}</span>
      </div>
    );
  return (
    <div id="io-box-props" data-io-props-box={box.path} className="h-full flex flex-col bg-slate-950 border-l border-slate-800 text-[11px]">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-slate-800">
        <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />
        {t && <span className="shrink-0 px-1 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-sky-300">{t}</span>}
        <span className="truncate font-semibold text-slate-100" title={box.name}>{box.name.replace(/\s*\([^()]*\)\s*$/, '')}</span>
        <button type="button" onClick={() => onShowInTree(box.path)} className="ml-auto shrink-0 p-0.5 rounded hover:bg-slate-800 text-slate-400" title="Show it in the tree">
          <ListTree className="w-3.5 h-3.5" />
        </button>
        <button id="io-box-props-close" type="button" onClick={onClose} className="shrink-0 p-0.5 rounded hover:bg-slate-800 text-slate-400" title="Close (Esc)">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar px-2 py-1.5 space-y-3">
        <section>
          <h4 className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Device</h4>
          {row('Name', info?.esi?.name || box.info?.type || '', 'name')}
          {row('Type', box.info?.desc && box.info.desc !== t ? `${t} (${box.info.desc})` : t, 'type')}
          {row('Group', info?.esi?.group ?? '', 'group')}
          {row('Vendor', vendor, 'vendor')}
          {row('Product code', box.info?.productCode ?? '', 'product-code')}
          {row('Revision', box.info?.revision ? `${box.info.revision}${info?.esi?.revision === 'other' ? ' (TwinCAT here has another revision)' : ''}` : '', 'revision')}
          {row('Box', box.id !== undefined ? `Id ${box.id}` : '', 'box-id')}
          {row('EtherCAT address', state?.address !== undefined ? `${state.address}${box.address !== undefined && state.address !== box.address ? ` (the project's default: ${box.address})` : ''}` : box.address ?? '', 'address')}
          {row('Slave', box.slave !== null && box.slave !== undefined ? `#${box.slave + 1} of the master's` : box.disabled ? 'disabled' : '', 'slave')}
          {row('Port A to', where, 'port-a')}
          <div id="io-box-props-source" className="pt-1 text-[10px] text-slate-500">
            {loading
              ? 'Reading TwinCAT\'s device description…'
              : info?.esi
                ? `From the project and TwinCAT's device file (${info.esi.file})`
                : info
                  ? `From the project (TwinCAT's device files on this computer do not describe it${info.esiDirs && !info.esiDirs.length ? ': none found' : ''})`
                  : 'From the project (the desktop app or Link also reads TwinCAT\'s device files)'}
          </div>
        </section>

        <section>
          <h4 className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">State</h4>
          {state ? (
            <>
              <div data-io-prop="state" className={`font-bold ${state.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{stateText(state)}</div>
              {state.crc && (
                <div id="io-box-props-crc" className="mt-1 flex gap-1.5" title="CRC errors counted on each port by the master (rising: a cable or connector to check)">
                  {state.crc.map((n, i) => (
                    <span key={i} data-io-crc={PORTS[i]} className={`px-1.5 rounded border font-mono ${n ? 'border-amber-700 bg-amber-950/50 text-amber-200' : 'border-slate-800 text-slate-500'}`}>
                      {PORTS[i]}: {n}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-slate-500">{box.disabled ? 'Disabled in the project' : 'Not known (not live, or the master does not answer)'}</div>
          )}
        </section>

        {links.length > 0 && (
          <section>
            <h4 className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">More about it</h4>
            <div className="flex flex-wrap gap-1.5">
              {links.map((l) => (
                <a key={l.kind} data-io-link={l.kind} href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 text-sky-300 hover:bg-slate-800" title={l.url}>
                  {l.kind === 'manual' ? <FileText className="w-3 h-3" /> : l.kind === 'search' || l.kind === 'web' ? <Search className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
                  {l.label}
                </a>
              ))}
            </div>
            <div className="pt-1 text-[10px] text-slate-500">On the vendor's site: photos, the connection diagram (its contacts), technical data. Some types have no page of their own there: then its search finds it.</div>
          </section>
        )}

        <section>
          <h4 className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Pictures</h4>
          {info?.images.length ? (
            <div id="io-box-props-images" className="grid grid-cols-2 gap-1.5">
              {info.images.map((im) => (
                <button key={im.name} type="button" data-io-image={im.name} onClick={() => setZoom(im.dataUrl)} className="rounded border border-slate-800 bg-slate-900 p-1 hover:border-sky-600" title={`${im.name} (click: bigger)`}>
                  <img src={im.dataUrl} alt={im.name} className="w-full h-24 object-contain" />
                  <div className="truncate text-[9px] text-slate-500">{im.name}</div>
                </button>
              ))}
            </div>
          ) : (
            <div id="io-box-props-no-images" className="flex items-start gap-1.5 text-slate-500">
              <ImageOff className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                {fetchInfo
                  ? <>No pictures of {t || 'it'} yet: put your own (front, back, its wiring) in {info?.folder ? <span className="font-mono text-slate-400 break-all">{info.folder}</span> : 'the Devices folder'}, named like <span className="font-mono text-slate-400">{t || 'EL1008'}.png</span> or <span className="font-mono text-slate-400">{t || 'EL1008'} front.jpg</span>.</>
                  : 'Your own pictures of a device are shown in the desktop app, or through Link.'}
              </span>
            </div>
          )}
          {onOpenFolder && (
            <button id="io-box-props-open-folder" type="button" onClick={onOpenFolder} className="mt-1 flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
              <FolderOpen className="w-3 h-3" /> Open the pictures folder
            </button>
          )}
        </section>

        {entries.length > 0 && (
          <section>
            <h4 className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Channels ({entries.length})</h4>
            {entries.map((e) => {
              const v = e.link ? valueOf(e.link) : undefined;
              return (
                <div key={e.path} data-io-prop-entry={e.path} className="flex items-center gap-1.5 py-0.5" title={`${e.pdo} / ${e.name}${e.type ? ` (${e.type})` : ''}`}>
                  {e.dir === 'in' ? <ArrowDownToLine className="w-3 h-3 text-emerald-400 shrink-0" /> : <ArrowUpFromLine className="w-3 h-3 text-amber-400 shrink-0" />}
                  <span className="shrink-0 text-slate-400">{e.pdo === '(other links)' ? '' : `${e.pdo} · `}{e.name}</span>
                  {e.link && <span className="min-w-0 truncate font-mono text-slate-500">{e.link}</span>}
                  {e.link && <span className="ml-auto shrink-0 font-mono text-slate-200">{v === undefined ? '—' : show(v.v)}</span>}
                </div>
              );
            })}
          </section>
        )}

        {events.length > 0 && (
          <section>
            <h4 className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Recent events</h4>
            {events.slice(0, 10).map((ev, i) => (
              <div key={i} data-io-prop-event="" className={`py-0.5 ${ev.ok ? 'text-slate-300' : 'text-rose-300'}`}>
                <span className="font-mono text-slate-500">{new Date(ev.at).toLocaleTimeString()}</span> {ev.text}
              </div>
            ))}
          </section>
        )}
      </div>
      {zoom && (
        <div id="io-box-props-zoom" className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-6" onClick={() => setZoom(null)} title="Click to close">
          <img src={zoom} alt="" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>
  );
};
