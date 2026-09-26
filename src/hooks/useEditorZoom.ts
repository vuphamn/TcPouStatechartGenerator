import { useEffect, useState, useCallback } from 'react';

/**
 * Text size of the code editors (Method Editor, Enum Editor), as Visual Studio's / TwinCAT XAE's editor zoom:
 * Ctrl+mouse wheel. One level for every editor, kept per viewer.
 */

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
const KEY = 'kss.editor.zoom';
const EVENT = 'kss-editor-zoom';

const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10));

function readZoom(): number {
  try {
    const z = parseFloat(localStorage.getItem(KEY) || '');
    return Number.isFinite(z) ? clamp(z) : 1;
  } catch {
    return 1;
  }
}

let current = readZoom();

export function setEditorZoom(z: number): number {
  const next = clamp(z);
  if (next === current) return current;
  current = next;
  try {
    localStorage.setItem(KEY, String(next));
  } catch {
    // per-viewer convenience only
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  return next;
}

/** The editors' zoom (1 = 100%) and a setter shared by all of them */
export function useEditorZoom(): [number, (z: number) => number] {
  const [zoom, setZoom] = useState(current);
  useEffect(() => {
    const onZoom = (e: Event) => setZoom((e as CustomEvent<number>).detail);
    // Another tab / window of the app
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      current = readZoom();
      setZoom(current);
    };
    window.addEventListener(EVENT, onZoom);
    window.addEventListener('storage', onStorage);
    setZoom(current);
    return () => {
      window.removeEventListener(EVENT, onZoom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return [zoom, useCallback((z: number) => setEditorZoom(z), [])];
}
