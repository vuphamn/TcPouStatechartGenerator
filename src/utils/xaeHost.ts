import { DutCandidate } from './dutMatcher.ts';
import { PouSource } from './sourceFileAccess.ts';

/**
 * Bridge to the TwinCAT XAE extension (xae-extension/), which shows this app in a WebView2 document tab.
 * The extension owns file access: it loads the right-clicked .TcPOU, searches its folder tree for .TcDUT files
 * and saves edits back into the project.
 */

/** Messages from the extension */
export type HostMessage =
  /** instance / live: the tab was opened to follow this PLC instance of the POU (openInstance) */
  | { type: 'loadPou'; source: PouSource; instance?: string; live?: boolean; connection?: Record<string, string> }
  | { type: 'dutCandidates'; candidates: DutCandidate[]; forceFirst: boolean }
  /** files: XAE's version of each saved file (it can differ slightly from what was sent) */
  | { type: 'saveResult'; ok: boolean; message: string; files?: { path: string; content: string }[] }
  /** A loaded file changed in XAE or on disk (content is XAE's version) */
  | { type: 'sourceChanged'; path: string; name: string; content: string }
  /** Live view: connection state (connected carries the followed instance and the instances found in the PLC) */
  | {
      type: 'liveStatus';
      state: 'connecting' | 'connected' | 'error' | 'lost' | 'stopped' | 'plcState';
      message?: string;
      target?: string;
      plcState?: string;
      instance?: string;
      instances?: string[];
      symbolType?: string;
      /** Desktop: the address this computer uses towards the PLC (the PLC needs a route for it) */
      route?: { localNetId: string; localIp: string };
    }
  /** Live view: new values of the state variable (t: PLC time, ms since 1970) */
  | { type: 'liveValues'; events: { t: number; value: number }[] }
  /** Guard variables (liveWatch): where each was found in the PLC, or why not */
  | { type: 'liveWatchResult'; vars: { id: string; symbol?: string; type?: string; error?: string }[] }
  /** Guard variables: new values (null: not a finite number) */
  | { type: 'liveVars'; values: { id: string; t: number; v: boolean | number | string | null }[] }
  /** The committed (git HEAD) version of a loaded file */
  | { type: 'gitShowResult'; requestId: number; content?: string | null; error?: string | null }
  /** Project documentation: the PLC project's state machine POUs and all its enums */
  | { type: 'projectPous'; project?: string; pous?: { name: string; path?: string; content: string }[]; duts?: DutCandidate[]; error?: string }
  | { type: 'saveDocumentResult'; path?: string; error?: string; canceled?: boolean }
  /** Two-way selection: the caret in TwinCAT's editor of the loaded POU (line of the editor, both parts) */
  | { type: 'editorCaret'; method: string; line: number; lineCount: number }
  /** Symbol browser: a symbol and its members (one level), or why not */
  | ({ type: 'liveBrowseResult' } & LiveBrowseResult)
  | { type: 'error'; message: string };

/** A member of a browsed PLC symbol. value: a number / boolean / string shown with its value; struct / array: has
 * members; other: pointers, references, ... stateMachine: holds the state variable (a POU the app can follow) */
export interface SymbolChild {
  name: string;
  path: string;
  type: string;
  kind: 'value' | 'struct' | 'array' | 'other';
  stateMachine?: boolean;
  /** A state machine's state variable type, and its names by value when the PLC describes the enum */
  stateType?: string;
  stateNames?: Record<string, string>;
}

export interface LiveBrowseResult {
  requestId: number;
  path: string;
  /** The symbol's type (not "type": that is the message's) */
  symbolType?: string;
  kind?: SymbolChild['kind'];
  stateMachine?: boolean;
  stateType?: string;
  stateNames?: Record<string, string>;
  truncated?: boolean;
  children?: SymbolChild[];
  error?: string | null;
}

/** Messages to the extension */
/** A guard variable to follow: its id (the variable as written, lower case) and the symbol paths to try */
export interface LiveWatchVar {
  id: string;
  candidates: string[];
}

export type AppMessage =
  | { type: 'ready' }
  | { type: 'browsePou' }
  | { type: 'findDut' }
  | { type: 'chooseDutFiles' }
  /** baseline: the version the edit is based on; force: overwrite a change made in XAE since then */
  | { type: 'save'; files: { path: string; content: string; baseline?: string; force?: boolean }[] }
  /** Open TwinCAT's editor of a method of the loaded POU at a line */
  | { type: 'navigate'; path: string; method: string; line: number; text?: string }
  /** Follow the POU's state variable in the running PLC (empty fields: found from the project) */
  | { type: 'liveStart'; path: string; stateVar: string; instance?: string; netId?: string; port?: number }
  | { type: 'liveStop' }
  /** Guard variables to follow (replaces the previous set): the first candidate path the PLC has is used */
  | { type: 'liveWatch'; vars: LiveWatchVar[] }
  /** The committed (git HEAD) version of a loaded file (answered with gitShowResult) */
  | { type: 'gitShow'; path: string; requestId: number }
  /** Open another POU of the same PLC project: a referenced state machine (typeName) or a previous one (path) */
  | { type: 'openPou'; typeName?: string; path?: string }
  /** Another tab on this POU, following another PLC instance of it (a tab already following it comes forward) */
  | { type: 'openInstance'; path?: string; instance: string; typeName?: string; connection?: Record<string, string> }
  /** Symbol browser: a symbol's members in the connected PLC (answered with liveBrowseResult) */
  | { type: 'liveBrowse'; requestId: number; path: string; stateVar: string }
  /** Project documentation: the loaded POU's PLC project files (answered with projectPous) */
  | { type: 'projectPous' }
  /** Save a document (a save dialog; answered with saveDocumentResult) */
  | { type: 'saveDocument'; name: string; content: string };

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
