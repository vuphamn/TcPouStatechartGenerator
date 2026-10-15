import React, { useEffect, useState } from 'react';
import { Printer, X } from 'lucide-react';
import QRCode from 'qrcode';

/** A label: what it is (a machine, a drive, an I/O box), on which PLC, and its address on the board */
export interface QrItem {
  kind: 'm' | 'd' | 'b';
  plc: string;
  plcName: string;
  path: string;
  label: string;
  detail?: string;
}

/** The board's address that opens this item on a phone (?board&focus=<kind>:<plc>|<path>) */
export function focusUrl(item: Pick<QrItem, 'kind' | 'plc' | 'path'>): string {
  const u = new URL(window.location.href);
  const board = u.searchParams.get('board');
  const gateway = u.searchParams.get('gateway');
  return `${u.origin}${u.pathname}?board${board ? `=${encodeURIComponent(board)}` : ''}${gateway ? `&gateway=${encodeURIComponent(gateway)}` : ''}&focus=${encodeURIComponent(`${item.kind}:${item.plc}|${item.path}`)}`;
}

const KIND = { m: 'Machine', d: 'Drive', b: 'I/O' };

/**
 * QR labels to print and stick on a cabinet, a drive, a terminal: each one's code opens the board on a phone at that
 * item (its state, what to do, its faults and work orders, Call maintenance). A sheet of labels (3 a row), to print or
 * save as PDF.
 */
export const QrSheet: React.FC<{ items: QrItem[]; onClose: () => void }> = ({ items, onClose }) => {
  const [codes, setCodes] = useState<Record<string, string>>({});
  useEffect(() => {
    let gone = false;
    void Promise.all(items.map(async (it) => [`${it.kind}:${it.plc}|${it.path}`, await QRCode.toString(focusUrl(it), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })] as const)).then((list) => {
      if (!gone) setCodes(Object.fromEntries(list));
    });
    return () => {
      gone = true;
    };
  }, [items]);
  return (
    <div id="qr-sheet" className="qr-sheet fixed inset-0 z-50 overflow-y-auto bg-white text-slate-900">
      <style>{'@media print { body * { visibility: hidden !important; } .qr-sheet, .qr-sheet * { visibility: visible !important; } .qr-sheet { position: absolute !important; inset: 0 !important; overflow: visible !important; } .qr-sheet-bar { display: none !important; } }'}</style>
      <div className="qr-sheet-bar sticky top-0 flex items-center gap-2 border-b border-slate-300 bg-slate-100 px-4 py-2 print:hidden">
        <span className="font-semibold">{items.length} QR label{items.length === 1 ? '' : 's'}</span>
        <span className="text-sm text-slate-500">Scanned with a phone, each opens the board at its item (signed in to the gateway).</span>
        <button type="button" onClick={() => window.print()} className="ml-auto flex items-center gap-1 px-3 py-1 rounded bg-slate-800 text-white">
          <Printer className="w-4 h-4" /> Print
        </button>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-200" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3 p-4">
        {items.map((it) => {
          const k = `${it.kind}:${it.plc}|${it.path}`;
          return (
            <div key={k} className="qr-label flex items-center gap-3 rounded border border-slate-400 p-3 break-inside-avoid" data-focus={k}>
              <div className="w-28 h-28 shrink-0" dangerouslySetInnerHTML={{ __html: codes[k] ?? '' }} />
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-slate-500">{KIND[it.kind]} · {it.plcName}</div>
                <div className="font-bold leading-tight break-words">{it.label}</div>
                {it.detail && <div className="text-xs text-slate-600 break-words">{it.detail}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
