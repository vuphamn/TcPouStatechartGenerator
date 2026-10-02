import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PanelTopClose, Undo2 } from 'lucide-react';
import { DockFloatingWindow } from '../../utils/dockLayout.ts';
import { DockHostRegistry, DockTabSlot } from './DockHost.tsx';
import { addAppWindow, removeAppWindow } from '../../utils/appWindows.ts';

// The open windows by tab: a remount right after an unmount (React's development double effects) keeps its window
const openWindows = new Map<string, { w: Window; root: HTMLElement; observer: MutationObserver; closeTimer?: number }>();

// Windows still loading, and a pending close of one (a remount at once opens the same window again, by its name)
const loadingWindows = new Map<string, { w: Window; closeTimer?: number }>();

interface ExternalDockWindowProps {
  win: DockFloatingWindow;
  meta: { title: string; icon: React.ReactNode };
  registry: DockHostRegistry;
  /** Back into the app as a floating window (also when the window is closed) */
  onPopIn: () => void;
  /** Back into its tab group */
  onDock: () => void;
}

/**
 * A tab in a browser window of its own, to move outside the app (another monitor). The tab's content is the same
 * React tree: its host element moves into the window (portals keep their events), the app's style sheets are copied
 * in. Closing the window brings the tab back.
 */
/** A new window made ready for a tab: the app's style sheets (kept in step), its classes, a root element */
function setUpWindow(w: Window, title: string) {
  const doc = w.document;
  doc.title = `${title} - Kval MachineScope`;
  // The app's style sheets, kept in step (the dev server replaces them on edits)
  const copyStyles = () => {
    doc.head.querySelectorAll('[data-kss-copied]').forEach((n) => n.remove());
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
      const c = n.cloneNode(true) as HTMLElement;
      c.setAttribute('data-kss-copied', '');
      if (c instanceof HTMLLinkElement) c.href = (n as HTMLLinkElement).href;
      doc.head.appendChild(c);
    });
  };
  copyStyles();
  const observer = new MutationObserver(copyStyles);
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  doc.documentElement.className = document.documentElement.className;
  doc.documentElement.setAttribute('style', document.documentElement.getAttribute('style') ?? '');
  doc.body.className = document.body.className;
  doc.body.style.cssText = 'margin:0;height:100vh;overflow:hidden';
  const root = doc.createElement('div');
  root.id = 'dock-external-root';
  root.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column';
  doc.body.appendChild(root);
  // The app's shortcuts: keys pressed here (not while typing) go to the app's window too
  w.addEventListener('keydown', (e) => {
    const t = doc.activeElement as HTMLElement | null;
    if (e.defaultPrevented || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))) return;
    const clone = new KeyboardEvent('keydown', { key: e.key, code: e.code, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, bubbles: true, cancelable: true });
    window.dispatchEvent(clone);
    if (clone.defaultPrevented) e.preventDefault();
  });
  addAppWindow(w);
  return { w, root, observer };
}

export const ExternalDockWindow: React.FC<ExternalDockWindowProps> = ({ win, meta, registry, onPopIn, onDock }) => {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const popInRef = useRef(onPopIn);
  popInRef.current = onPopIn;
  const titleRef = useRef(meta.title);
  titleRef.current = meta.title;

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;
    // Watching the window: closed by the user (the tab comes back), or with the app
    const attach = (entry: NonNullable<ReturnType<typeof openWindows.get>>) => {
      const { w } = entry;
      let done = false;
      const back = () => {
        if (done) return;
        done = true;
        popInRef.current();
      };
      w.addEventListener('pagehide', back);
      const poll = window.setInterval(() => {
        if (!w.closed) return;
        removeAppWindow(w);
        back();
      }, 500);
      // (the app going: the window closes with it, the tab stays marked as in its own window, to offer reopening it)
      const closeWindow = () => {
        done = true;
        w.close();
      };
      window.addEventListener('beforeunload', closeWindow);
      detach = () => {
        done = true;
        w.removeEventListener('pagehide', back);
        window.clearInterval(poll);
        window.removeEventListener('beforeunload', closeWindow);
      };
    };

    const existing = openWindows.get(win.tabId);
    if (existing && !existing.w.closed) {
      window.clearTimeout(existing.closeTimer);
      setContainer(existing.root);
      attach(existing);
    } else {
      const features = `popup=yes,width=${Math.round(win.width)},height=${Math.round(win.height) + 30},left=${Math.round(window.screenX + 60)},top=${Math.round(window.screenY + 60)}`;
      // The app's own page (the address a browser shows names the window), filled once it is loaded
      const url = `${import.meta.env.BASE_URL}window.html?${encodeURIComponent(titleRef.current.replace(/\s+/g, '-'))}`;
      window.clearTimeout(loadingWindows.get(win.tabId)?.closeTimer);
      const opened = window.open(url, `kss-dock-${win.tabId}`, features);
      if (!opened) {
        // (blocked, or the host does not open windows): stays in the app
        popInRef.current();
        return;
      }
      loadingWindows.set(win.tabId, { w: opened });
      const started = Date.now();
      const wait = window.setInterval(() => {
        let loaded = false;
        try {
          loaded = opened.document.readyState === 'complete' && /window\.html/.test(opened.location.pathname);
        } catch {
          loaded = false;
        }
        if (cancelled || opened.closed) return window.clearInterval(wait);
        if (!loaded && Date.now() - started < 10000) return;
        window.clearInterval(wait);
        loadingWindows.delete(win.tabId);
        const entry = setUpWindow(opened, titleRef.current);
        openWindows.set(win.tabId, entry);
        setContainer(entry.root);
        attach(entry);
      }, 30);
    }
    return () => {
      cancelled = true;
      detach?.();
      const current = openWindows.get(win.tabId);
      const loading = loadingWindows.get(win.tabId);
      if (!current && loading) {
        // (gone before its window was ready: closed, unless mounted again at once)
        loading.closeTimer = window.setTimeout(() => {
          loadingWindows.delete(win.tabId);
          loading.w.close();
        }, 60);
      }
      if (!current) return;
      // (the tab's content is parked by now: its slot unmounted first); closed unless mounted again at once
      current.closeTimer = window.setTimeout(() => {
        current.observer.disconnect();
        openWindows.delete(win.tabId);
        removeAppWindow(current.w);
        current.w.close();
      }, 60);
    };
    // Opened once per tab; its size is where it starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.tabId]);

  if (!container) return null;
  return createPortal(
    <div id={`dock-external-${win.tabId}`} className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="flex items-center gap-1.5 h-7 px-2 shrink-0 bg-slate-900 border-b border-slate-800 text-[11px] font-medium select-none">
        <span className="shrink-0 text-sky-400 [&>svg]:w-3.5 [&>svg]:h-3.5">{meta.icon}</span>
        <span className="flex-1 truncate">{meta.title}</span>
        <button type="button" onClick={onPopIn} title="Back into the app (floating)" className="flex items-center gap-1 px-1.5 py-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-700">
          <Undo2 className="w-3.5 h-3.5" /> Back to the app
        </button>
        <button type="button" onClick={onDock} title="Dock into its document group" className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-700">
          <PanelTopClose className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="relative flex-1 min-h-0 flex flex-col">
        <DockTabSlot tabId={win.tabId} registry={registry} />
      </div>
    </div>,
    container
  );
};
