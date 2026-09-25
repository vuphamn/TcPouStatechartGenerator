import React, { useRef, useState } from 'react';
import { AppWindow, ChevronDown, PanelLeft, PanelRight, RotateCcw } from 'lucide-react';
import {
  DOCK_TAB_HOME,
  DOCK_TAB_ORDER,
  DockLayout,
  DockPanelId,
  DockTabId,
  activateDockTab,
  createDefaultDockLayout,
  isDockTabOpen,
} from '../../utils/dockLayout.ts';
import { DockLayoutUpdater, DockTabMeta } from './DockPanelView.tsx';
import { DockMenu, DockMenuItem } from './DockMenu.tsx';

interface WindowMenuButtonProps {
  layout: DockLayout;
  onLayoutChange: DockLayoutUpdater;
  tabMeta: Record<DockTabId, DockTabMeta>;
}

const PANEL_LABELS: Record<DockPanelId, string> = {
  middle: 'Middle Panel (Documents)',
  right: 'Right Panel (Tool Windows)',
};

/** "Window" menu: reopen closed tabs in their original panel, toggle side panels, reset layout */
export const WindowMenuButton: React.FC<WindowMenuButtonProps> = ({ layout, onLayoutChange, tabMeta }) => {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const closedAtRef = useRef<number>(0);

  const tabItems = (panel: DockPanelId): DockMenuItem[] => [
    { id: `heading-${panel}`, heading: true, label: PANEL_LABELS[panel] },
    ...DOCK_TAB_ORDER.filter((t) => DOCK_TAB_HOME[t] === panel).map((t) => {
      const open = isDockTabOpen(layout, t);
      return {
        id: `window-${t}`,
        label: tabMeta[t].title,
        icon: tabMeta[t].icon,
        checked: open,
        hint: open ? undefined : 'closed',
        onSelect: () => onLayoutChange((l) => activateDockTab(l, t)),
      };
    }),
  ];

  const items: DockMenuItem[] = [
    { id: 'heading-panels', heading: true, label: 'Main Panels' },
    {
      id: 'toggle-left',
      label: 'Left Panel (TwinCAT Source Files)',
      icon: <PanelLeft className="w-3.5 h-3.5" />,
      checked: layout.leftVisible,
      onSelect: () => onLayoutChange((l) => ({ ...l, leftVisible: !l.leftVisible })),
    },
    {
      id: 'toggle-right',
      label: 'Right Panel (Tool Windows)',
      icon: <PanelRight className="w-3.5 h-3.5" />,
      checked: layout.rightVisible,
      onSelect: () => onLayoutChange((l) => ({ ...l, rightVisible: !l.rightVisible })),
    },
    { id: 'sep-1', separator: true },
    ...tabItems('middle'),
    { id: 'sep-2', separator: true },
    ...tabItems('right'),
    { id: 'sep-3', separator: true },
    {
      id: 'reset-layout',
      label: 'Reset Window Layout',
      icon: <RotateCcw className="w-3.5 h-3.5" />,
      onSelect: () => onLayoutChange(() => createDefaultDockLayout()),
    },
  ];

  const closedCount = DOCK_TAB_ORDER.filter((t) => !isDockTabOpen(layout, t)).length;

  return (
    <>
      <button
        id="window-menu-btn"
        type="button"
        onClick={(e) => {
          // The outside-click handler already closed the menu when this button was pressed
          if (Date.now() - closedAtRef.current < 250) return;
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { x: r.left, y: r.bottom + 4 });
        }}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-800 transition-colors shrink-0"
        title="Window: reopen closed tabs, show/hide panels, reset layout"
      >
        <AppWindow className="w-3.5 h-3.5 text-sky-400" />
        <span className="hidden md:inline">Window</span>
        {closedCount > 0 && (
          <span
            className="px-1 rounded bg-slate-800 text-[10px] font-mono text-slate-400"
            title={`${closedCount} closed tab${closedCount === 1 ? '' : 's'}`}
          >
            {closedCount}
          </span>
        )}
        <ChevronDown className="w-3 h-3 text-slate-500" />
      </button>
      {anchor && (
        <DockMenu
          id="window-menu"
          x={anchor.x}
          y={anchor.y}
          items={items}
          onClose={() => {
            setAnchor(null);
            closedAtRef.current = Date.now();
          }}
        />
      )}
    </>
  );
};
