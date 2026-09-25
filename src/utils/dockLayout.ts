/**
 * TwinCAT XAE / Visual Studio style docking layout model.
 *
 * The workspace has three main panels:
 *   - LeftPanel:   TwinCAT source files (fixed content, resizable width)
 *   - MiddlePanel: document tab groups side-by-side (vertical splitters) + floating windows
 *   - RightPanel:  tool window tab groups stacked vertically (horizontal splitters)
 *
 * Tabs can only be moved within their home panel. A closed tab is reopened in its home panel,
 * in the tab group it was last docked in when that group still exists.
 */

export type DockPanelId = 'middle' | 'right';

export type DockTabId =
  | 'diagram'
  | 'method'
  | 'enum'
  | 'complexity'
  | 'frequency'
  | 'history'
  | 'docs'
  | 'problems'
  | 'live'
  | 'markdown'
  | 'search'
  | 'stats'
  | 'heatmap'
  | 'legend'
  | 'notes'
  | 'minimap';

/** Canonical tab order; also used to pick the insert position when a tab is reopened */
export const DOCK_TAB_ORDER: DockTabId[] = [
  'diagram',
  'method',
  'enum',
  'complexity',
  'frequency',
  'history',
  'docs',
  'problems',
  'live',
  'markdown',
  'search',
  'stats',
  'heatmap',
  'legend',
  'notes',
  'minimap',
];

export const DOCK_TAB_HOME: Record<DockTabId, DockPanelId> = {
  diagram: 'middle',
  method: 'middle',
  enum: 'middle',
  complexity: 'middle',
  frequency: 'middle',
  history: 'middle',
  docs: 'right',
  problems: 'right',
  live: 'right',
  markdown: 'right',
  search: 'right',
  stats: 'right',
  heatmap: 'right',
  legend: 'right',
  notes: 'right',
  minimap: 'right',
};

export interface DockGroup {
  id: string;
  tabs: DockTabId[];
  active: DockTabId | null;
  /** Relative flex weight of this group within its panel */
  size: number;
}

export interface DockFloatingWindow {
  tabId: DockTabId;
  /** Position & size in px, relative to the MiddlePanel */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DockPanelState {
  groups: DockGroup[];
  /** Undocked windows, last entry is top-most (MiddlePanel only) */
  floating: DockFloatingWindow[];
}

export interface DockLayout {
  version: 1;
  middle: DockPanelState;
  right: DockPanelState;
  leftWidth: number;
  rightWidth: number;
  leftVisible: boolean;
  rightVisible: boolean;
  /** Group each tab was last docked in, used to restore closed / floating tabs */
  lastGroup: Partial<Record<DockTabId, string>>;
  /** Position & size of groups removed when their last tab left, so a reopened tab gets its group back */
  removedGroups?: Record<string, { index: number; size: number }>;
  /** Tabs this layout was saved with; any other tab is new and gets its default placement on load */
  knownTabs?: DockTabId[];
}

/** Tabs that existed before `knownTabs` was recorded */
const LEGACY_KNOWN_TABS: DockTabId[] = [
  'diagram', 'method', 'enum', 'complexity', 'frequency', 'history',
  'docs', 'markdown', 'search', 'minimap',
];

export type DockTabLocation =
  | { panel: DockPanelId; kind: 'group'; groupIndex: number; tabIndex: number }
  | { panel: DockPanelId; kind: 'float'; floatIndex: number };

const STORAGE_KEY = 'tc_statechart_dock_layout_v1';
const MIN_GROUP_SIZE = 0.05;

export const LEFT_PANEL_DEFAULT_WIDTH = 400;
export const RIGHT_PANEL_DEFAULT_WIDTH = 400;
export const SIDE_PANEL_MIN_WIDTH = 220;

const newGroupId = () => `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function createDefaultDockLayout(): DockLayout {
  return {
    version: 1,
    middle: {
      groups: [
        {
          id: 'middle-main',
          tabs: ['diagram', 'method', 'enum', 'complexity', 'frequency', 'history'],
          active: 'diagram',
          size: 1,
        },
      ],
      floating: [],
    },
    right: {
      groups: [
        { id: 'right-inspector', tabs: ['docs', 'problems', 'live', 'markdown'], active: 'docs', size: 1.3 },
        { id: 'right-search', tabs: ['search', 'stats', 'heatmap', 'legend', 'notes'], active: 'search', size: 1.2 },
        { id: 'right-minimap', tabs: ['minimap'], active: 'minimap', size: 0.6 },
      ],
      floating: [],
    },
    leftWidth: LEFT_PANEL_DEFAULT_WIDTH,
    rightWidth: RIGHT_PANEL_DEFAULT_WIDTH,
    leftVisible: true,
    rightVisible: true,
    lastGroup: {},
    knownTabs: [...DOCK_TAB_ORDER],
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function findDockTab(layout: DockLayout, tabId: DockTabId): DockTabLocation | null {
  for (const panel of ['middle', 'right'] as DockPanelId[]) {
    const state = layout[panel];
    for (let g = 0; g < state.groups.length; g++) {
      const t = state.groups[g].tabs.indexOf(tabId);
      if (t >= 0) return { panel, kind: 'group', groupIndex: g, tabIndex: t };
    }
    const f = state.floating.findIndex((w) => w.tabId === tabId);
    if (f >= 0) return { panel, kind: 'float', floatIndex: f };
  }
  return null;
}

export function isDockTabOpen(layout: DockLayout, tabId: DockTabId): boolean {
  return findDockTab(layout, tabId) !== null;
}

/** True when the tab's content is on screen (active in its group, or floating) */
export function isDockTabVisible(layout: DockLayout, tabId: DockTabId): boolean {
  const loc = findDockTab(layout, tabId);
  if (!loc) return false;
  if (loc.panel === 'right' && !layout.rightVisible) return false;
  if (loc.kind === 'float') return true;
  return layout[loc.panel].groups[loc.groupIndex].active === tabId;
}

export function getDockGroupOfTab(layout: DockLayout, tabId: DockTabId): DockGroup | null {
  const loc = findDockTab(layout, tabId);
  if (!loc || loc.kind !== 'group') return null;
  return layout[loc.panel].groups[loc.groupIndex];
}

// ---------------------------------------------------------------------------
// Internal helpers (immutable)
// ---------------------------------------------------------------------------

function withPanel(layout: DockLayout, panel: DockPanelId, state: DockPanelState): DockLayout {
  return { ...layout, [panel]: state };
}

/** Picks a replacement active tab after `removedIndex` was taken out of `tabs` */
function nextActive(tabs: DockTabId[], removedIndex: number): DockTabId | null {
  if (tabs.length === 0) return null;
  return tabs[Math.min(removedIndex, tabs.length - 1)];
}

/** Removes empty groups, keeping at least one (possibly empty) group per panel */
function pruneGroups(groups: DockGroup[]): DockGroup[] {
  const nonEmpty = groups.filter((g) => g.tabs.length > 0);
  if (nonEmpty.length > 0) return nonEmpty;
  return groups.length > 0 ? [{ ...groups[0], tabs: [], active: null }] : [];
}

/** Detaches a tab from wherever it lives in its panel, remembering its group */
function detachTab(layout: DockLayout, tabId: DockTabId, prune = true): DockLayout {
  const loc = findDockTab(layout, tabId);
  if (!loc) return layout;
  const state = layout[loc.panel];

  if (loc.kind === 'float') {
    return withPanel(layout, loc.panel, {
      ...state,
      floating: state.floating.filter((w) => w.tabId !== tabId),
    });
  }

  const group = state.groups[loc.groupIndex];
  const tabs = group.tabs.filter((t) => t !== tabId);
  const active = group.active === tabId ? nextActive(tabs, loc.tabIndex) : group.active;
  const groups = state.groups.map((g, i) => (i === loc.groupIndex ? { ...g, tabs, active } : g));
  const removedGroups =
    tabs.length === 0 && state.groups.length > 1
      ? { ...layout.removedGroups, [group.id]: { index: loc.groupIndex, size: group.size } }
      : layout.removedGroups;

  return {
    ...withPanel(layout, loc.panel, { ...state, groups: prune ? pruneGroups(groups) : groups }),
    lastGroup: { ...layout.lastGroup, [tabId]: group.id },
    removedGroups,
  };
}

/** Index to insert a reopened tab so the canonical tab order is preserved */
function canonicalInsertIndex(tabs: DockTabId[], tabId: DockTabId): number {
  const order = DOCK_TAB_ORDER.indexOf(tabId);
  const idx = tabs.findIndex((t) => DOCK_TAB_ORDER.indexOf(t) > order);
  return idx < 0 ? tabs.length : idx;
}

function insertIntoGroup(
  layout: DockLayout,
  tabId: DockTabId,
  groupId: string | undefined,
  index: number | 'canonical',
  makeActive: boolean
): DockLayout {
  const panel = DOCK_TAB_HOME[tabId];
  const state = layout[panel];
  let groups = state.groups.length > 0 ? state.groups : [{ id: newGroupId(), tabs: [], active: null, size: 1 }];
  let gIndex = groupId ? groups.findIndex((g) => g.id === groupId) : -1;

  const removed = groupId ? layout.removedGroups?.[groupId] : undefined;
  if (gIndex < 0 && groupId && removed) {
    // Replace a single empty placeholder group, otherwise re-insert at the remembered position
    const onlyEmpty = groups.length === 1 && groups[0].tabs.length === 0;
    const recreated: DockGroup = { id: groupId, tabs: [], active: null, size: removed.size };
    gIndex = onlyEmpty ? 0 : Math.min(removed.index, groups.length);
    groups = onlyEmpty ? [recreated] : [...groups.slice(0, gIndex), recreated, ...groups.slice(gIndex)];
  }
  if (gIndex < 0) gIndex = 0;
  const group = groups[gIndex];
  const tabs = [...group.tabs];
  const at = index === 'canonical' ? canonicalInsertIndex(tabs, tabId) : Math.max(0, Math.min(index, tabs.length));
  tabs.splice(at, 0, tabId);
  const active = makeActive || !group.active ? tabId : group.active;

  const next = withPanel(layout, panel, {
    ...state,
    groups: groups.map((g, i) => (i === gIndex ? { ...g, tabs, active } : g)),
  });
  if (!groupId || !layout.removedGroups?.[groupId]) return next;
  const { [groupId]: _restored, ...rest } = layout.removedGroups;
  return { ...next, removedGroups: rest };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Shows a tab: reopens it in its home panel if closed, activates it, or raises its floating window */
export function activateDockTab(layout: DockLayout, tabId: DockTabId): DockLayout {
  const panel = DOCK_TAB_HOME[tabId];
  let next = panel === 'right' && !layout.rightVisible ? { ...layout, rightVisible: true } : layout;
  const loc = findDockTab(next, tabId);

  if (!loc) {
    return insertIntoGroup(next, tabId, next.lastGroup[tabId], 'canonical', true);
  }

  const state = next[loc.panel];
  if (loc.kind === 'float') {
    const win = state.floating[loc.floatIndex];
    if (loc.floatIndex === state.floating.length - 1) return next;
    return withPanel(next, loc.panel, {
      ...state,
      floating: [...state.floating.filter((w) => w.tabId !== tabId), win],
    });
  }

  if (state.groups[loc.groupIndex].active === tabId) return next;
  next = withPanel(next, loc.panel, {
    ...state,
    groups: state.groups.map((g, i) => (i === loc.groupIndex ? { ...g, active: tabId } : g)),
  });
  return next;
}

/**
 * Makes a tab available without covering `protectedTab`: if both share a tab group and the
 * protected tab is currently showing, the tab is opened in the background instead of activated.
 */
export function revealDockTab(layout: DockLayout, tabId: DockTabId, protectedTab: DockTabId): DockLayout {
  const protectedGroup = getDockGroupOfTab(layout, protectedTab);
  const protectedShowing = protectedGroup?.active === protectedTab;
  const loc = findDockTab(layout, tabId);

  if (!loc) {
    const targetGroupId = layout.lastGroup[tabId] ?? layout[DOCK_TAB_HOME[tabId]].groups[0]?.id;
    const coversProtected = protectedShowing && protectedGroup?.id === targetGroupId;
    return insertIntoGroup(layout, tabId, targetGroupId, 'canonical', !coversProtected);
  }

  if (loc.kind === 'group' && protectedShowing && layout[loc.panel].groups[loc.groupIndex].id === protectedGroup?.id) {
    return layout;
  }
  return activateDockTab(layout, tabId);
}

export function closeDockTab(layout: DockLayout, tabId: DockTabId): DockLayout {
  return detachTab(layout, tabId);
}

/** Closes every other tab in the group that contains `tabId` */
export function closeOtherDockTabs(layout: DockLayout, tabId: DockTabId): DockLayout {
  const group = getDockGroupOfTab(layout, tabId);
  if (!group) return layout;
  return group.tabs.filter((t) => t !== tabId).reduce((acc, t) => detachTab(acc, t), layout);
}

/** Moves a tab to another tab group (or reorders it) within its home panel */
export function moveDockTab(layout: DockLayout, tabId: DockTabId, targetGroupId: string, index?: number): DockLayout {
  const panel = DOCK_TAB_HOME[tabId];
  const target = layout[panel].groups.find((g) => g.id === targetGroupId);
  if (!target) return layout;

  const loc = findDockTab(layout, tabId);
  let insertAt = index ?? target.tabs.length;
  // Reordering within the same group: account for the tab's own removal
  if (loc?.kind === 'group' && layout[panel].groups[loc.groupIndex].id === targetGroupId && loc.tabIndex < insertAt) {
    insertAt -= 1;
  }

  const detached = detachTab(layout, tabId, false);
  const inserted = insertIntoGroup(detached, tabId, targetGroupId, insertAt, true);
  return withPanel(inserted, panel, { ...inserted[panel], groups: pruneGroups(inserted[panel].groups) });
}

/** Creates a new tab group next to `targetGroupId` containing `tabId` (e.g. "New Vertical Document Group") */
export function splitDockTab(
  layout: DockLayout,
  tabId: DockTabId,
  targetGroupId: string,
  side: 'before' | 'after'
): DockLayout {
  const panel = DOCK_TAB_HOME[tabId];
  const target = layout[panel].groups.find((g) => g.id === targetGroupId);
  if (!target) return layout;
  // Splitting a group's only tab next to itself would leave an empty group behind
  if (target.tabs.length === 1 && target.tabs[0] === tabId) return layout;

  const detached = detachTab(layout, tabId, false);
  const state = detached[panel];
  const gIndex = state.groups.findIndex((g) => g.id === targetGroupId);
  const half = Math.max(MIN_GROUP_SIZE, state.groups[gIndex].size / 2);
  const created: DockGroup = { id: newGroupId(), tabs: [tabId], active: tabId, size: half };

  const groups = state.groups.map((g, i) => (i === gIndex ? { ...g, size: half } : g));
  groups.splice(side === 'before' ? gIndex : gIndex + 1, 0, created);
  return withPanel(detached, panel, { ...state, groups: pruneGroups(groups) });
}

/** Moves a tab into the next / previous tab group of its panel */
export function moveDockTabToAdjacentGroup(layout: DockLayout, tabId: DockTabId, direction: 1 | -1): DockLayout {
  const loc = findDockTab(layout, tabId);
  if (!loc || loc.kind !== 'group') return layout;
  const target = layout[loc.panel].groups[loc.groupIndex + direction];
  return target ? moveDockTab(layout, tabId, target.id) : layout;
}

/** Undocks a MiddlePanel tab into a floating window positioned inside the MiddlePanel */
export function floatDockTab(
  layout: DockLayout,
  tabId: DockTabId,
  rect: Omit<DockFloatingWindow, 'tabId'>
): DockLayout {
  const panel = DOCK_TAB_HOME[tabId];
  if (panel !== 'middle') return layout;
  const detached = detachTab(layout, tabId);
  const state = detached[panel];
  return withPanel(detached, panel, { ...state, floating: [...state.floating, { tabId, ...rect }] });
}

/** Docks a floating window back into its last tab group (or the first group) */
export function dockFloatingTab(layout: DockLayout, tabId: DockTabId, groupId?: string): DockLayout {
  const loc = findDockTab(layout, tabId);
  if (!loc || loc.kind !== 'float') return layout;
  const detached = detachTab(layout, tabId);
  return insertIntoGroup(detached, tabId, groupId ?? layout.lastGroup[tabId], 'canonical', true);
}

export function updateFloatingWindow(
  layout: DockLayout,
  tabId: DockTabId,
  rect: Partial<Omit<DockFloatingWindow, 'tabId'>>
): DockLayout {
  const panel = DOCK_TAB_HOME[tabId];
  const state = layout[panel];
  return withPanel(layout, panel, {
    ...state,
    floating: state.floating.map((w) => (w.tabId === tabId ? { ...w, ...rect } : w)),
  });
}

export function setDockGroupSizes(layout: DockLayout, panel: DockPanelId, sizes: number[]): DockLayout {
  const state = layout[panel];
  if (sizes.length !== state.groups.length) return layout;
  return withPanel(layout, panel, {
    ...state,
    groups: state.groups.map((g, i) => ({ ...g, size: Math.max(MIN_GROUP_SIZE, sizes[i]) })),
  });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function sanitizePanel(raw: unknown, panel: DockPanelId, seen: Set<DockTabId>): DockPanelState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<DockPanelState>;
  if (!Array.isArray(r.groups)) return null;

  const keepTab = (t: unknown): t is DockTabId => {
    if (typeof t !== 'string' || !(t in DOCK_TAB_HOME)) return false;
    const id = t as DockTabId;
    if (DOCK_TAB_HOME[id] !== panel || seen.has(id)) return false;
    seen.add(id);
    return true;
  };

  const groups: DockGroup[] = r.groups
    .filter((g): g is DockGroup => Boolean(g) && typeof g === 'object' && typeof g.id === 'string' && Array.isArray(g.tabs))
    .map((g) => {
      const tabs = g.tabs.filter(keepTab);
      const active = g.active && tabs.includes(g.active) ? g.active : tabs[0] ?? null;
      const size = typeof g.size === 'number' && g.size > 0 ? g.size : 1;
      return { id: g.id, tabs, active, size };
    });

  const floating: DockFloatingWindow[] =
    panel === 'middle' && Array.isArray(r.floating)
      ? r.floating.filter(
          (w): w is DockFloatingWindow =>
            Boolean(w) &&
            typeof w === 'object' &&
            keepTab(w.tabId) &&
            [w.x, w.y, w.width, w.height].every((n) => typeof n === 'number' && Number.isFinite(n))
        )
      : [];

  return { groups: pruneGroups(groups.length ? groups : [{ id: newGroupId(), tabs: [], active: null, size: 1 }]), floating };
}

export function loadDockLayout(): DockLayout {
  const fallback = createDefaultDockLayout();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DockLayout>;
    if (!parsed || parsed.version !== 1) return fallback;

    const seen = new Set<DockTabId>();
    const middle = sanitizePanel(parsed.middle, 'middle', seen);
    const right = sanitizePanel(parsed.right, 'right', seen);
    if (!middle || !right) return fallback;

    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const loaded: DockLayout = {
      version: 1,
      middle,
      right,
      leftWidth: Math.max(SIDE_PANEL_MIN_WIDTH, num(parsed.leftWidth, LEFT_PANEL_DEFAULT_WIDTH)),
      rightWidth: Math.max(SIDE_PANEL_MIN_WIDTH, num(parsed.rightWidth, RIGHT_PANEL_DEFAULT_WIDTH)),
      leftVisible: parsed.leftVisible !== false,
      rightVisible: parsed.rightVisible !== false,
      lastGroup: parsed.lastGroup && typeof parsed.lastGroup === 'object' ? parsed.lastGroup : {},
      removedGroups: parsed.removedGroups && typeof parsed.removedGroups === 'object' ? parsed.removedGroups : {},
      knownTabs: [...DOCK_TAB_ORDER],
    };
    const known = Array.isArray(parsed.knownTabs) ? parsed.knownTabs : LEGACY_KNOWN_TABS;
    return addNewTabs(loaded, fallback, known);
  } catch {
    return fallback;
  }
}

/** Places tabs unknown to a saved layout where the default layout has them (without activating) */
function addNewTabs(layout: DockLayout, defaults: DockLayout, known: DockTabId[]): DockLayout {
  let next = layout;
  for (const tabId of DOCK_TAB_ORDER) {
    if (known.includes(tabId) || isDockTabOpen(next, tabId)) continue;
    const panel = DOCK_TAB_HOME[tabId];
    const defaultGroup = defaults[panel].groups.find((g) => g.tabs.includes(tabId));
    // Prefer the default group, else the group holding a default neighbour, else the panel's first group
    const neighbour = defaultGroup?.tabs.find((t) => t !== tabId && getDockGroupOfTab(next, t));
    const target =
      next[panel].groups.find((g) => g.id === defaultGroup?.id) ??
      (neighbour ? getDockGroupOfTab(next, neighbour) : null) ??
      next[panel].groups[0];
    next = insertIntoGroup(next, tabId, target?.id, 'canonical', false);
  }
  return next;
}

export function saveDockLayout(layout: DockLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore
  }
}
