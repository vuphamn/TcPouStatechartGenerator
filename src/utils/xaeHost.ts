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
      // (programChanged: another program was downloaded or activated while connected: the app connects again)
      state: 'connecting' | 'connected' | 'error' | 'lost' | 'stopped' | 'plcState' | 'programChanged';
      message?: string;
      target?: string;
      plcState?: string;
      instance?: string;
      instances?: string[];
      symbolType?: string;
      /** The followed instance's own type in the PLC (MAIN.mainStateMachine: TransferTable): compared with the loaded POU */
      instanceType?: string | null;
      /** The state variable's enum as the PLC has it (value -> name; null: not an enum, or not known) */
      stateNames?: Record<string, string> | null;
      /** The TwinCAT project the PLC's configuration was activated from (its boot folder's CurrentProjectInfo.json) */
      activeProject?: { name: string; created?: string | null; plcProjects?: string[] } | null;
      /** XAE: the PLC's TwinCAT build (3.1.4024: 4024; null: not known) and the XAE's (its Remote Manager's: "4024.59") */
      twinCatBuild?: number | null;
      xaeBuild?: number | null;
      xaeVersion?: string | null;
      /** Desktop: the address this computer uses towards the PLC (the PLC needs a route for it) */
      route?: { localNetId: string; localIp: string };
      /** An error: nothing on the chosen ADS port, the PLC runtimes it has (port, state) */
      ports?: { port: number; state: string }[];
    }
  /** Live view: new values of the state variable (t: PLC time, ms since 1970) */
  | { type: 'liveValues'; events: { t: number; value: number }[] }
  /** Guard variables (liveWatch): where each was found in the PLC, or why not */
  | { type: 'liveWatchResult'; vars: { id: string; symbol?: string; type?: string; error?: string }[] }
  /** Guard variables: new values (null: not a finite number) */
  | { type: 'liveVars'; values: { id: string; t: number; v: boolean | number | string | null }[] }
  /** The committed (git HEAD) version of a loaded file */
  | { type: 'gitShowResult'; requestId: number; content?: string | null; error?: string | null }
  /** A POU's layout file (<POU>.machinescope.json): read (text; null: none yet) or written */
  | { type: 'layoutResult'; requestId: number; text?: string | null; written?: boolean; error?: string | null }
  /** Project documentation: the PLC project's state machine POUs and all its enums */
  | { type: 'projectPous'; project?: string; pous?: { name: string; path?: string; content: string }[]; duts?: DutCandidate[]; error?: string }
  // A POU of the project by type name (a base the loaded POU EXTENDS), read only
  | { type: 'findPouResult'; requestId: number; typeName?: string; source?: PouSource; error?: string }
  /** A rename's other files: the project's POUs whose code has the name */
  | { type: 'projectUses'; requestId?: number; files?: { name: string; path: string; content: string }[]; error?: string }
  /** The other files written (saveOther) */
  | { type: 'saveOtherResult'; requestId?: number; ok: boolean; message?: string }
  /** The PLC project's type files (declarations only), for completion and the checks */
  | { type: 'projectSymbols'; project?: string; files?: { name: string; path?: string; content: string }[]; error?: string }
  | { type: 'saveDocumentResult'; path?: string; error?: string; canceled?: boolean }
  /** Two-way selection: the caret in TwinCAT's editor of the loaded POU (line of the editor, both parts) */
  | { type: 'editorCaret'; method: string; line: number; lineCount: number }
  /** Symbol browser: a symbol and its members (one level), or why not */
  | ({ type: 'liveBrowseResult' } & LiveBrowseResult)
  /** Save All from another MachineScope tab of this XAE (relayed by the extension), and the answers to ours */
  | { type: 'saveAll'; id: string; relayed?: boolean }
  | { type: 'saveAllDone'; id: string; name?: string; count?: number; relayed?: boolean }
  /** Build for the PLC (desktop app, Link, gateway): what XAE does now */
  | { type: 'plcBuildProgress'; requestId: number; text: string }
  /** XAE edition: XAE's own build of the open solution, its Error List */
  | { type: 'xaeBuildResult'; requestId: number; ok: boolean; errors?: number; warnings?: number; fatal?: string; items?: { level: 'error' | 'warning'; text: string; file: string; line: number; column?: number; project?: string }[] }
  /** The Live tab's Browse: the router's routes and the devices on the network (route: XAE can go live on it) */
  | {
      type: 'plcList';
      requestId: number;
      devices?: { netId: string; ip: string; name: string; twincat?: string; os?: string; route?: boolean; source?: 'network' | 'route' | 'project' }[];
      errors?: string[];
      projectTarget?: string | null;
    }
  /** Add Route (both ways, through XAE): done, or why not */
  | { type: 'addRouteResult'; requestId: number; ok: boolean; message: string }
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
  /** None of them there: a member of "under" whose name holds these words (a method's VAR_INST: a sub-machine's) */
  search?: { under: string; words: string[] };
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
  /** A loaded POU's layout file beside it: read, or written (text; null: removed) */
  | { type: 'layoutRead'; path: string; requestId: number }
  | { type: 'layoutWrite'; path: string; requestId: number; text: string | null }
  /** Open another POU of the same PLC project: a referenced state machine (typeName) or a previous one (path) */
  | { type: 'openPou'; typeName?: string; path?: string }
  /** Open a POU (or DUT, interface) of the loaded POU's PLC project in TwinCAT's editor */
  | { type: 'openInXae'; typeName: string; method?: string; line?: number; text?: string }
  /** Another tab on this POU, following another PLC instance of it (a tab already following it comes forward) */
  | { type: 'openInstance'; path?: string; instance: string; typeName?: string; connection?: Record<string, string> }
  /** Symbol browser: a symbol's members in the connected PLC (answered with liveBrowseResult) */
  | { type: 'liveBrowse'; requestId: number; path: string; stateVar: string }
  /** The Live tab's Browse: search for PLCs (answered with plcList) */
  | { type: 'discoverPlcs'; requestId: number; addresses: string[] }
  /** Add Route to a PLC, both ways (answered with addRouteResult); the password is only passed to XAE */
  | { type: 'addRoute'; requestId: number; netId: string; ip: string; name: string; user: string; password: string }
  /** Project documentation: the loaded POU's PLC project files (answered with projectPous) */
  | { type: 'projectPous' }
  | { type: 'findPou'; requestId: number; typeName: string }
  /** The PLC project's types (answered with projectSymbols) */
  | { type: 'projectSymbols' }
  /** The project's POUs whose code has a name (answered with projectUses) */
  | { type: 'projectUses'; requestId: number; name: string }
  /** Other POUs of the project written (a rename; answered with saveOtherResult) */
  | { type: 'saveOther'; requestId: number; files: { path: string; content: string; baseline: string }[] }
  /** Save a document (a save dialog; answered with saveDocumentResult) */
  | { type: 'saveDocument'; name: string; content: string; personal?: boolean }
  /** Build: XAE's own build of the open solution (answered with xaeBuildResult) */
  | { type: 'buildProject'; requestId: number }
  /** Save All: to the other MachineScope tabs of this XAE, and this tab's answer to theirs */
  | { type: 'saveAllRelay'; id: string }
  | { type: 'saveAllDoneRelay'; id: string; name: string; count: number };

interface WebViewBridge {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
}

const bridge = (window as unknown as { chrome?: { webview?: WebViewBridge } }).chrome?.webview;

/** Running inside the TwinCAT XAE extension */
export const isXaeHost = () => Boolean(bridge);
/** Hosted in VS Code (its extension's webview: its shim sets window.__kssHost), not in TwinCAT XAE */
export const isVsCodeHost = () => isXaeHost() && (window as unknown as { __kssHost?: string }).__kssHost === 'vscode';
/** Where "Show in …" opens the code: VS Code's editor (the .TcPOU), else TwinCAT's */
export const hostEditorName = () => (isVsCodeHost() ? 'the .TcPOU (VS Code)' : 'TwinCAT editor');

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
