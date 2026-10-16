import React, { useEffect, useRef, useState } from 'react';
import { Camera, FileText, X } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';
import { t } from '../utils/boardLang.ts';

/** An attachment as the gateway keeps it (gateway/attachments.cjs) */
export interface AttachmentMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  by: string;
  at: string;
}

const MAX_BYTES = 512 * 1024;
const MAX_SIDE = 1600;

const base64Of = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * A file made ready for the gateway: a photo at most 1600 px on its longer side, as JPEG, smaller until it fits
 * 512 KB; a PDF as it is (at most 512 KB)
 */
export async function attachmentOf(file: File): Promise<{ name: string; type: string; data: string }> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BYTES) throw new Error(`${file.name}: at most 512 KB for a PDF`);
    return { name: file.name, type: file.type, data: base64Of(await file.arrayBuffer()) };
  }
  if (!file.type.startsWith('image/')) throw new Error(`${file.name}: a photo or a PDF`);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`${file.name}: not a photo the browser reads`));
      i.src = url;
    });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.8, 0.65, 0.5, 0.35]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= MAX_BYTES) return { name: file.name.replace(/\.\w+$/, '') + '.jpg', type: 'image/jpeg', data: base64Of(await blob.arrayBuffer()) };
    }
    throw new Error(`${file.name}: too large even made smaller`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One attachment read from the gateway (its data URL, cached for the page) */
const cache = new Map<string, string>();
const useAttachment = (conn: GatewayConnection | null, id: string) => {
  const [src, setSrc] = useState(() => cache.get(id) ?? '');
  useEffect(() => {
    if (src || !conn) return;
    let live = true;
    void conn
      .request<{ ok: boolean; contentType?: string; data?: string }>({ type: 'attachmentGet', id }, 'attachmentGetResult')
      .then((r) => {
        if (!r.ok || !r.data || !r.contentType) return;
        const u = `data:${r.contentType};base64,${r.data}`;
        cache.set(id, u);
        if (live) setSrc(u);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [conn, id, src]);
  return src;
};

const Thumb: React.FC<{ conn: GatewayConnection | null; a: AttachmentMeta; onOpen: (src: string) => void }> = ({ conn, a, onOpen }) => {
  const src = useAttachment(conn, a.id);
  const pdf = a.type === 'application/pdf';
  return (
    <button type="button" className="attachment-thumb relative w-20 h-20 rounded border border-slate-700 bg-slate-950 overflow-hidden flex items-center justify-center" data-attachment={a.id} title={`${a.name} · ${a.by} · ${new Date(a.at).toLocaleString()}`} onClick={() => src && onOpen(src)}>
      {pdf ? <FileText className="w-8 h-8 text-slate-400" /> : src ? <img src={src} alt={a.name} className="w-full h-full object-cover" /> : <span className="text-[10px] text-slate-500">…</span>}
      {pdf && <span className="absolute bottom-0 inset-x-0 truncate bg-black/60 px-1 text-[9px] text-slate-200">{a.name}</span>}
    </button>
  );
};

/**
 * The photos (and PDFs) of a work order, a call, a handover: thumbnails (a click: the photo, a PDF in a new tab),
 * and, when one may add, a button: a phone opens its camera
 */
export const Attachments: React.FC<{ conn: GatewayConnection | null; items: AttachmentMeta[]; canAdd: boolean; onAdd?: (files: File[]) => Promise<string | null>; label?: string }> = ({ conn, items, canAdd, onAdd, label = 'Photo…' }) => {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('');
  const open = (src: string) => {
    if (src.startsWith('data:application/pdf')) {
      const w = window.open();
      if (w) w.document.write(`<iframe src="${src}" style="border:0;width:100%;height:100%"></iframe>`);
    } else setView(src);
  };
  if (!items.length && !canAdd) return null;
  return (
    <div className="attachments space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {items.map((a) => (
          <Thumb key={a.id} conn={conn} a={a} onOpen={open} />
        ))}
        {canAdd && onAdd && (
          <>
            <input
              ref={input}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              multiple
              className="hidden attachment-input"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                if (!files.length) return;
                setBusy(true);
                setError('');
                void onAdd(files).then((err) => {
                  setBusy(false);
                  if (err) setError(err);
                });
              }}
            />
            <button type="button" disabled={busy} onClick={() => input.current?.click()} className="attachment-add flex items-center gap-1 px-2 py-1 rounded border border-slate-600 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50" title={t('A photo (a phone: its camera) or a PDF')}>
              <Camera className="w-4 h-4" />
              {busy ? t('Adding…') : label}
            </button>
          </>
        )}
      </div>
      {error && <div className="attachment-error text-xs text-rose-300">{error}</div>}
      {view && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onMouseDown={() => setView('')}>
          <img src={view} alt="" className="max-w-[95vw] max-h-[95vh] object-contain" />
          <button type="button" className="absolute top-3 right-3 p-2 rounded bg-slate-800 text-white" onClick={() => setView('')} title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
};

/** Files sent to the gateway one by one: their metas (the first error stops them) */
export async function uploadAttachments(conn: GatewayConnection | null, files: File[]): Promise<{ metas: AttachmentMeta[]; error: string | null }> {
  const metas: AttachmentMeta[] = [];
  if (!conn) return { metas, error: 'Not connected to the gateway' };
  for (const f of files) {
    try {
      const file = await attachmentOf(f);
      const r = await conn.request<{ ok: boolean; error?: string; attachment?: AttachmentMeta }>({ type: 'attachmentAdd', file }, 'attachmentAddResult', 60000);
      if (!r.ok || !r.attachment) return { metas, error: r.error ?? 'Not kept' };
      metas.push(r.attachment);
    } catch (e) {
      return { metas, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { metas, error: null };
}
