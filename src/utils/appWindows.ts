/**
 * The app's windows: the main one and the windows tabs were moved to (Move to New Window). Listeners that must hear
 * those windows too (a press on the canvas in a moved tab) attach to all of them.
 */
const windows = new Set<Window>();
const listeners = new Set<() => void>();

export function addAppWindow(w: Window) {
  windows.add(w);
  listeners.forEach((l) => l());
}

export function removeAppWindow(w: Window) {
  if (!windows.delete(w)) return;
  listeners.forEach((l) => l());
}

/** The main window and the moved tabs' windows still open */
export function appWindows(): Window[] {
  return [window, ...[...windows].filter((w) => !w.closed)];
}

/** Calls back when a window opens or closes; returns the unsubscribe */
export function onAppWindowsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Attaches a listener to every app window (and to windows opened later); returns the detach */
export function listenOnAppWindows<K extends keyof WindowEventMap>(type: K, handler: (e: WindowEventMap[K]) => void, capture = false): () => void {
  let attached: Window[] = [];
  const attach = () => {
    attached.forEach((w) => w.removeEventListener(type, handler as EventListener, capture));
    attached = appWindows();
    attached.forEach((w) => w.addEventListener(type, handler as EventListener, capture));
  };
  attach();
  const off = onAppWindowsChange(attach);
  return () => {
    off();
    attached.forEach((w) => w.removeEventListener(type, handler as EventListener, capture));
  };
}
