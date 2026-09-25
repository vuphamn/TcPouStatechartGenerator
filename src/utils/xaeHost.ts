import { DutCandidate } from './dutMatcher.ts';
import { PouSource } from './sourceFileAccess.ts';

/**
 * Bridge to the TwinCAT XAE extension (xae-extension/), which shows this app in a WebView2 document tab.
 * The extension owns file access: it loads the right-clicked .TcPOU, searches its folder tree for .TcDUT files
 * and saves edits back into the project.
 */

/** Messages from the extension */
export type HostMessage =
  | { type: 'loadPou'; source: PouSource }
  | { type: 'dutCandidates'; candidates: DutCandidate[]; forceFirst: boolean }
  | { type: 'saveResult'; ok: boolean; message: string }
  | { type: 'error'; message: string };

/** Messages to the extension */
export type AppMessage =
  | { type: 'ready' }
  | { type: 'browsePou' }
  | { type: 'findDut' }
  | { type: 'chooseDutFiles' }
  | { type: 'save'; files: { path: string; content: string }[] };

interface WebViewBridge {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
}

const bridge = (window as unknown as { chrome?: { webview?: WebViewBridge } }).chrome?.webview;

/** Running inside the TwinCAT XAE extension */
export const isXaeHost = () => Boolean(bridge);

export function postToHost(message: AppMessage): void {
  bridge?.postMessage(message);
}

/** Subscribes to messages from the extension; returns the unsubscribe function */
export function onHostMessage(handler: (message: HostMessage) => void): () => void {
  if (!bridge) return () => {};
  const listener = (e: { data: unknown }) => {
    const data = e.data as HostMessage | null;
    if (data && typeof data === 'object' && typeof data.type === 'string') handler(data);
  };
  bridge.addEventListener('message', listener);
  return () => bridge.removeEventListener('message', listener);
}
