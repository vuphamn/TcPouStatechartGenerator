import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  X,
  ChevronDown,
  Columns2,
  Rows2,
  ArrowRightToLine,
  ArrowLeftToLine,
  ArrowDownToLine,
  ArrowUpToLine,
  ExternalLink,
  PanelTopClose,
  XSquare,
  RotateCcw,
} from 'lucide-react';
import {
  DOCK_TAB_HOME,
  DOCK_TAB_ORDER,
  DockFloatingWindow,
  DockGroup,
  DockLayout,
  DockPanelId,
  DockTabId,
  activateDockTab,
  closeDockTab,
  closeOtherDockTabs,
  dockFloatingTab,
  floatDockTab,
  isDockTabOpen,
  moveDockTab,
  moveDockTabToAdjacentGroup,
  setDockGroupSizes,
  splitDockTab,
  updateFloatingWindow,
} from '../../utils/dockLayout.ts';
import { DockHostRegistry, DockTabSlot } from './DockHost.tsx';
import { DockSplitter } from './DockSplitter.tsx';
import { DockMenu, DockMenuItem } from './DockMenu.tsx';

export interface DockTabMeta {
  title: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  tooltip?: string;
}

export type DockLayoutUpdater = (updater: (layout: DockLayout) => DockLayout) => void;

// ---------------------------------------------------------------------------
// Shared drag state (which tab is being dragged via HTML5 drag & drop)
// ---------------------------------------------------------------------------

let draggedTab: DockTabId | null = null;
const dragListeners = new Set<() => void>();
const setDraggedTab = (tab: DockTabId | null) => {
  draggedTab = tab;
  dragListeners.forEach((l) => l());
};
const subscribeDrag = (l: () => void) => {
  dragListeners.add(l);
  return () => dragListeners.delete(l);
};
const useDraggedTab = () => useSyncExternalStore(subscribeDrag, () => draggedTab);

type DropZone = 'center' | 'before' | 'after';

const MIN_GROUP_PX = 120;
const FLOAT_MIN_W = 260;
const FLOAT_MIN_H = 180;
const FLOAT_TITLE_H = 28;

interface MenuState {
  x: number;
  y: number;
  items: DockMenuItem[];
}

interface DockPanelViewProps {
  id: string;
  panel: DockPanelId;
  layout: DockLayout;
  onLayoutChange: DockLayoutUpdater;
  tabMeta: Record<DockTabId, DockTabMeta>;
  registry: DockHostRegistry;
}

export const DockPanelView: React.FC<DockPanelViewProps> = ({ id, panel, layout, onLayoutChange, tabMeta, registry }) => {
  const state = layout[panel];
  const isRow = panel === 'middle';
  const allowFloating = panel === 'middle';
  const dragTab = useDraggedTab();
  const canDropHere = dragTab !== null && DOCK_TAB_HOME[dragTab] === panel;

  const rootRef = useRef<HTMLDivElement>(null);
  const [panelSize, setPanelSize] = useState({ width: 0, height: 0 });
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [liveSizes, setLiveSizes] = useState<number[] | null>(null);
  const [liveFloat, setLiveFloat] = useState<DockFloatingWindow | null>(null);
  const [dropTarget, setDropTarget] = useState<{ groupId: string; zone: DropZone } | null>(null);
  const [stripDrop, setStripDrop] = useState<{ groupId: string; index: number } | null>(null);
  const resizeStartRef = useRef<{ sizes: number[]; length: number } | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPanelSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clear drop indicators whenever a drag ends anywhere
  useEffect(() => {
    if (dragTab === null) {
      setDropTarget(null);
      setStripDrop(null);
    }
  }, [dragTab]);

  const closeMenu = useCallback(() => setMenu(null), []);
  const closedTabs = DOCK_TAB_ORDER.filter((t) => DOCK_TAB_HOME[t] === panel && !isDockTabOpen(layout, t));

  const defaultFloatRect = (): Omit<DockFloatingWindow, 'tabId'> => {
    const w = Math.max(FLOAT_MIN_W, Math.min(760, Math.round(panelSize.width * 0.6)));
    const h = Math.max(FLOAT_MIN_H, Math.min(560, Math.round(panelSize.height * 0.7)));
    const offset = state.floating.length * 24;
    return {
      x: Math.max(0, Math.round((panelSize.width - w) / 2) + offset),
      y: Math.max(0, Math.round((panelSize.height - h) / 3) + offset),
      width: w,
      height: h,
    };
  };

  // -------------------------------------------------------------------------
  // Menus
  // -------------------------------------------------------------------------

  const reopenItems = (): DockMenuItem[] =>
    closedTabs.length === 0
      ? []
      : [
          { id: 'sep-reopen', separator: true },
          { id: 'heading-reopen', heading: true, label: 'Reopen Closed Tab' },
          ...closedTabs.map((t) => ({
            id: `reopen-${t}`,
            label: tabMeta[t].title,
            icon: <RotateCcw className="w-3.5 h-3.5" />,
            onSelect: () => onLayoutChange((l) => activateDockTab(l, t)),
          })),
        ];

  const openTabMenu = (e: React.MouseEvent, tabId: DockTabId, groupIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const group = state.groups[groupIndex];
    const items: DockMenuItem[] = [
      {
        id: 'close',
        label: 'Close',
        icon: <X className="w-3.5 h-3.5" />,
        hint: 'Middle-click',
        onSelect: () => onLayoutChange((l) => closeDockTab(l, tabId)),
      },
      {
        id: 'close-others',
        label: 'Close All But This',
        icon: <XSquare className="w-3.5 h-3.5" />,
        disabled: group.tabs.length < 2,
        onSelect: () => onLayoutChange((l) => closeOtherDockTabs(l, tabId)),
      },
      { id: 'sep-1', separator: true },
    ];
    if (allowFloating) {
      items.push({
        id: 'float',
        label: 'Float',
        icon: <ExternalLink className="w-3.5 h-3.5" />,
        hint: 'Double-click',
        onSelect: () => onLayoutChange((l) => floatDockTab(l, tabId, defaultFloatRect())),
      });
    }
    items.push({
      id: isRow ? 'new-vertical-group' : 'new-horizontal-group',
      label: isRow ? 'New Vertical Document Group' : 'New Horizontal Tab Group',
      icon: isRow ? <Columns2 className="w-3.5 h-3.5" /> : <Rows2 className="w-3.5 h-3.5" />,
      disabled: group.tabs.length < 2,
      onSelect: () => onLayoutChange((l) => splitDockTab(l, tabId, group.id, 'after')),
    });
    items.push({
      id: 'move-next-group',
      label: 'Move to Next Tab Group',
      icon: isRow ? <ArrowRightToLine className="w-3.5 h-3.5" /> : <ArrowDownToLine className="w-3.5 h-3.5" />,
      disabled: groupIndex >= state.groups.length - 1,
      onSelect: () => onLayoutChange((l) => moveDockTabToAdjacentGroup(l, tabId, 1)),
    });
    items.push({
      id: 'move-prev-group',
      label: 'Move to Previous Tab Group',
      icon: isRow ? <ArrowLeftToLine className="w-3.5 h-3.5" /> : <ArrowUpToLine className="w-3.5 h-3.5" />,
      disabled: groupIndex === 0,
      onSelect: () => onLayoutChange((l) => moveDockTabToAdjacentGroup(l, tabId, -1)),
    });
    items.push(...reopenItems());
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const openGroupListMenu = (e: React.MouseEvent, group: DockGroup) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: DockMenuItem[] = [
      { id: 'heading-open', heading: true, label: 'Open Tabs' },
      ...group.tabs.map((t) => ({
        id: `goto-${t}`,
        label: tabMeta[t].title,
        icon: tabMeta[t].icon,
        checked: group.active === t,
        onSelect: () => onLayoutChange((l) => activateDockTab(l, t)),
      })),
      ...reopenItems(),
    ];
    setMenu({ x: rect.right - 220, y: rect.bottom + 2, items });
  };

  const openFloatMenu = (e: React.MouseEvent, tabId: DockTabId) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          id: 'dock',
          label: 'Dock',
          icon: <PanelTopClose className="w-3.5 h-3.5" />,
          hint: 'Double-click',
          onSelect: () => onLayoutChange((l) => dockFloatingTab(l, tabId)),
        },
        {
          id: 'close',
          label: 'Close',
          icon: <X className="w-3.5 h-3.5" />,
          onSelect: () => onLayoutChange((l) => closeDockTab(l, tabId)),
        },
      ],
    });
  };

  // -------------------------------------------------------------------------
  // Group splitters (live resize locally, commit on release)
  // -------------------------------------------------------------------------

  const handleSplitStart = () => {
    const el = rootRef.current;
    if (!el) return;
    const splitters = (state.groups.length - 1) * 4;
    resizeStartRef.current = {
      sizes: state.groups.map((g) => g.size),
      length: Math.max(1, (isRow ? el.clientWidth : el.clientHeight) - splitters),
    };
  };

  const handleSplitDrag = (index: number, delta: number) => {
    const start = resizeStartRef.current;
    if (!start) return;
    const total = start.sizes.reduce((a, b) => a + b, 0);
    const unitsPerPx = total / start.length;
    const minUnits = MIN_GROUP_PX * unitsPerPx;
    const pair = start.sizes[index - 1] + start.sizes[index];
    const before = Math.max(minUnits, Math.min(pair - minUnits, start.sizes[index - 1] + delta * unitsPerPx));
    const sizes = [...start.sizes];
    sizes[index - 1] = before;
    sizes[index] = pair - before;
    setLiveSizes(sizes);
  };

  const handleSplitEnd = () => {
    if (liveSizes) {
      const sizes = liveSizes;
      onLayoutChange((l) => setDockGroupSizes(l, panel, sizes));
    }
    setLiveSizes(null);
    resizeStartRef.current = null;
  };

  // -------------------------------------------------------------------------
  // Drag & drop of tabs
  // -------------------------------------------------------------------------

  const handleTabDragStart = (e: React.DragEvent, tabId: DockTabId) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabMeta[tabId].title);
    // Defer so the drag image is captured before drop overlays appear
    setTimeout(() => setDraggedTab(tabId), 0);
  };

  const handleStripDragOver = (e: React.DragEvent<HTMLDivElement>, group: DockGroup) => {
    if (!canDropHere) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tabEls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-dock-tab-header]'));
    let index = tabEls.length;
    for (let i = 0; i < tabEls.length; i++) {
      const r = tabEls[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) {
        index = i;
        break;
      }
    }
    if (stripDrop?.groupId !== group.id || stripDrop.index !== index) setStripDrop({ groupId: group.id, index });
    if (dropTarget) setDropTarget(null);
  };

  const handleStripDrop = (e: React.DragEvent, group: DockGroup) => {
    if (!canDropHere || !dragTab) return;
    e.preventDefault();
    const index = stripDrop?.groupId === group.id ? stripDrop.index : group.tabs.length;
    const tab = dragTab;
    onLayoutChange((l) => moveDockTab(l, tab, group.id, index));
    setDraggedTab(null);
  };

  const zoneFromEvent = (e: React.DragEvent<HTMLDivElement>): DropZone => {
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = isRow ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    if (ratio < 0.25) return 'before';
    if (ratio > 0.75) return 'after';
    return 'center';
  };

  const handleContentDragOver = (e: React.DragEvent<HTMLDivElement>, group: DockGroup) => {
    if (!canDropHere) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const zone = zoneFromEvent(e);
    if (dropTarget?.groupId !== group.id || dropTarget.zone !== zone) setDropTarget({ groupId: group.id, zone });
    if (stripDrop) setStripDrop(null);
  };

  const handleContentDrop = (e: React.DragEvent<HTMLDivElement>, group: DockGroup) => {
    if (!canDropHere || !dragTab) return;
    e.preventDefault();
    const zone = zoneFromEvent(e);
    const tab = dragTab;
    onLayoutChange((l) => (zone === 'center' ? moveDockTab(l, tab, group.id) : splitDockTab(l, tab, group.id, zone)));
    setDraggedTab(null);
  };

  // -------------------------------------------------------------------------
  // Floating windows (move / resize within the MiddlePanel)
  // -------------------------------------------------------------------------

  const clampFloat = (w: DockFloatingWindow): DockFloatingWindow => {
    const maxW = Math.max(FLOAT_MIN_W, panelSize.width);
    const maxH = Math.max(FLOAT_MIN_H, panelSize.height);
    const width = Math.max(FLOAT_MIN_W, Math.min(w.width, maxW));
    const height = Math.max(FLOAT_MIN_H, Math.min(w.height, maxH));
    return {
      ...w,
      width,
      height,
      x: Math.max(0, Math.min(w.x, panelSize.width - Math.min(width, 120))),
      y: Math.max(0, Math.min(w.y, panelSize.height - FLOAT_TITLE_H)),
    };
  };

  const startFloatGesture = (
    e: React.PointerEvent,
    win: DockFloatingWindow,
    mode: 'move' | 'resize-e' | 'resize-s' | 'resize-se'
  ) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    onLayoutChange((l) => activateDockTab(l, win.tabId));
    const startX = e.clientX;
    const startY = e.clientY;
    let latest = win;
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const next = { ...win };
      if (mode === 'move') {
        next.x = win.x + dx;
        next.y = win.y + dy;
      }
      if (mode === 'resize-e' || mode === 'resize-se') next.width = win.width + dx;
      if (mode === 'resize-s' || mode === 'resize-se') next.height = win.height + dy;
      latest = clampFloat(next);
      setLiveFloat(latest);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      const { tabId, ...rect } = latest;
      onLayoutChange((l) => updateFloatingWindow(l, tabId, rect));
      setLiveFloat(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const renderDropOverlay = (group: DockGroup) => {
    if (!canDropHere) return null;
    const active = dropTarget?.groupId === group.id ? dropTarget.zone : null;
    const highlight =
      active === 'center'
        ? 'inset-2'
        : active === 'before'
        ? isRow
          ? 'inset-y-2 left-2 w-1/2'
          : 'inset-x-2 top-2 h-1/2'
        : active === 'after'
        ? isRow
          ? 'inset-y-2 right-2 w-1/2'
          : 'inset-x-2 bottom-2 h-1/2'
        : '';
    return (
      <div
        className="absolute inset-0 z-30"
        data-dock-drop-overlay={group.id}
        onDragOver={(e) => handleContentDragOver(e, group)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);
        }}
        onDrop={(e) => handleContentDrop(e, group)}
      >
        {active && (
          <div className={`absolute ${highlight} rounded-md border-2 border-sky-400 bg-sky-500/20 pointer-events-none transition-all`}>
            <span className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-sky-600 text-white text-[10px] font-medium whitespace-nowrap">
              {active === 'center' ? 'Move into this tab group' : isRow ? 'New vertical document group' : 'New horizontal tab group'}
            </span>
          </div>
        )}
      </div>
    );
  };

  const sizes = liveSizes ?? state.groups.map((g) => g.size);
  const totalSize = sizes.reduce((a, b) => a + b, 0) || 1;

  const renderGroup = (group: DockGroup, groupIndex: number) => {
    const size = (sizes[groupIndex] ?? group.size) / totalSize;
    return (
      <div
        key={group.id}
        data-dock-group={group.id}
        className="flex flex-col min-w-0 min-h-0 overflow-hidden bg-slate-950"
        style={{ flexGrow: size, flexShrink: 1, flexBasis: 0 }}
      >
        {/* Tab strip */}
        <div
          role="tablist"
          data-dock-tabstrip={group.id}
          onDragOver={(e) => handleStripDragOver(e, group)}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setStripDrop(null);
          }}
          onDrop={(e) => handleStripDrop(e, group)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (closedTabs.length > 0) setMenu({ x: e.clientX, y: e.clientY, items: reopenItems().slice(1) });
          }}
          className="relative flex items-stretch h-8 shrink-0 bg-slate-900 border-b border-slate-800"
        >
          <div className="flex items-stretch min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
            {group.tabs.map((tabId, tabIndex) => {
              const meta = tabMeta[tabId];
              const isActive = group.active === tabId;
              return (
                <React.Fragment key={tabId}>
                  {stripDrop?.groupId === group.id && stripDrop.index === tabIndex && (
                    <div className="w-0.5 my-1 bg-sky-400 shrink-0 rounded" />
                  )}
                  <div
                    id={`dock-tab-${tabId}`}
                    role="tab"
                    aria-selected={isActive}
                    data-dock-tab-header={tabId}
                    draggable
                    title={meta.tooltip ?? meta.title}
                    onDragStart={(e) => handleTabDragStart(e, tabId)}
                    onDragEnd={() => setDraggedTab(null)}
                    onClick={() => onLayoutChange((l) => activateDockTab(l, tabId))}
                    onMouseDown={(e) => {
                      if (e.button === 1) e.preventDefault();
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1) onLayoutChange((l) => closeDockTab(l, tabId));
                    }}
                    onDoubleClick={() => {
                      if (allowFloating) onLayoutChange((l) => floatDockTab(l, tabId, defaultFloatRect()));
                    }}
                    onContextMenu={(e) => openTabMenu(e, tabId, groupIndex)}
                    className={`group/tab flex items-center gap-1.5 pl-2.5 pr-1 text-[11px] font-medium cursor-pointer select-none whitespace-nowrap border-r border-slate-800 border-t-2 transition-colors ${
                      isActive
                        ? 'bg-slate-950 text-sky-300 border-t-sky-500'
                        : 'text-slate-400 border-t-transparent hover:text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    <span className="shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5">{meta.icon}</span>
                    <span>{meta.title}</span>
                    {meta.badge}
                    <button
                      type="button"
                      aria-label={`Close ${meta.title}`}
                      title="Close tab"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLayoutChange((l) => closeDockTab(l, tabId));
                      }}
                      className={`p-0.5 rounded hover:bg-slate-700 hover:text-white ${
                        isActive ? 'opacity-80' : 'opacity-0 group-hover/tab:opacity-80'
                      }`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </React.Fragment>
              );
            })}
            {stripDrop?.groupId === group.id && stripDrop.index === group.tabs.length && (
              <div className="w-0.5 my-1 bg-sky-400 shrink-0 rounded" />
            )}
            {/* Free space in the strip is also a drop target */}
            <div className="flex-1 min-w-[24px]" />
          </div>
          <button
            type="button"
            title="Show tab list"
            aria-label="Show tab list"
            onClick={(e) => openGroupListMenu(e, group)}
            className="px-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 border-l border-slate-800 shrink-0"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="relative flex-1 min-h-0 flex flex-col">
          {group.active ? (
            <DockTabSlot key={group.active} tabId={group.active} registry={registry} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs text-slate-500">
              <span>No open tabs in this {isRow ? 'document group' : 'panel'}.</span>
              {closedTabs.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1.5">
                  {closedTabs.map((t) => (
                    <button
                      key={t}
                      type="button"
                      id={`dock-reopen-${t}`}
                      onClick={() => onLayoutChange((l) => activateDockTab(l, t))}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-700 bg-slate-900 text-slate-300 hover:text-white hover:border-sky-600 [&>svg]:w-3.5 [&>svg]:h-3.5"
                    >
                      {tabMeta[t].icon}
                      <span>{tabMeta[t].title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {renderDropOverlay(group)}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      id={id}
      className={`relative flex-1 min-h-0 min-w-0 flex overflow-hidden ${isRow ? 'flex-row' : 'flex-col'}`}
    >
      {state.groups.map((group, i) => (
        <React.Fragment key={group.id}>
          {i > 0 && (
            <DockSplitter
              orientation={isRow ? 'vertical' : 'horizontal'}
              onDragStart={handleSplitStart}
              onDrag={(d) => handleSplitDrag(i, d)}
              onDragEnd={handleSplitEnd}
              title="Drag to resize tab groups"
            />
          )}
          {renderGroup(group, i)}
        </React.Fragment>
      ))}

      {allowFloating &&
        state.floating.map((stored, zIndex) => {
          const win = clampFloat(liveFloat?.tabId === stored.tabId ? liveFloat : stored);
          const meta = tabMeta[win.tabId];
          return (
            <FloatingDockWindow
              key={win.tabId}
              win={win}
              zIndex={40 + zIndex}
              meta={meta}
              registry={registry}
              onRaise={() => onLayoutChange((l) => activateDockTab(l, win.tabId))}
              onGesture={(e, mode) => startFloatGesture(e, stored, mode)}
              onDock={() => onLayoutChange((l) => dockFloatingTab(l, win.tabId))}
              onClose={() => onLayoutChange((l) => closeDockTab(l, win.tabId))}
              onContextMenu={(e) => openFloatMenu(e, win.tabId)}
            />
          );
        })}

      {menu && <DockMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </div>
  );
};

interface FloatingDockWindowProps {
  win: DockFloatingWindow;
  zIndex: number;
  meta: DockTabMeta;
  registry: DockHostRegistry;
  onRaise: () => void;
  onGesture: (e: React.PointerEvent, mode: 'move' | 'resize-e' | 'resize-s' | 'resize-se') => void;
  onDock: () => void;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const FloatingDockWindow: React.FC<FloatingDockWindowProps> = ({
  win,
  zIndex,
  meta,
  registry,
  onRaise,
  onGesture,
  onDock,
  onClose,
  onContextMenu,
}) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const raiseRef = useRef(onRaise);
  raiseRef.current = onRaise;

  // Tab content is portaled, so React events from it never reach this window: listen natively
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const handler = () => raiseRef.current();
    el.addEventListener('pointerdown', handler, true);
    return () => el.removeEventListener('pointerdown', handler, true);
  }, []);

  return (
    <div
      id={`dock-float-${win.tabId}`}
      data-dock-float={win.tabId}
      style={{ left: win.x, top: win.y, width: win.width, height: win.height, zIndex }}
      className="absolute flex flex-col rounded-lg overflow-hidden bg-slate-950 border border-sky-700/70 shadow-2xl shadow-black/60"
    >
      <div
        onPointerDown={(e) => onGesture(e, 'move')}
        onDoubleClick={onDock}
        onContextMenu={onContextMenu}
        className="flex items-center gap-1.5 h-7 px-2 shrink-0 bg-slate-900 border-b border-slate-800 text-[11px] font-medium text-slate-200 cursor-move select-none touch-none"
        title="Drag to move within the document area. Double-click to dock."
      >
        <span className="shrink-0 text-sky-400 [&>svg]:w-3.5 [&>svg]:h-3.5">{meta.icon}</span>
        <span className="flex-1 truncate">{meta.title}</span>
        <button
          type="button"
          id={`dock-float-dock-${win.tabId}`}
          onClick={onDock}
          title="Dock into document group"
          className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-700"
        >
          <PanelTopClose className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-rose-900/70"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div ref={bodyRef} className="relative flex-1 min-h-0 flex flex-col">
        <DockTabSlot tabId={win.tabId} registry={registry} />
      </div>
      <div onPointerDown={(e) => onGesture(e, 'resize-e')} className="absolute top-7 right-0 bottom-3 w-1.5 cursor-ew-resize touch-none" />
      <div onPointerDown={(e) => onGesture(e, 'resize-s')} className="absolute left-0 right-3 bottom-0 h-1.5 cursor-ns-resize touch-none" />
      <div onPointerDown={(e) => onGesture(e, 'resize-se')} className="absolute right-0 bottom-0 w-3 h-3 cursor-nwse-resize touch-none" />
    </div>
  );
};
