import React, { useLayoutEffect, useRef } from 'react';
import { DOCK_TAB_ORDER, DockTabId } from '../../utils/dockLayout.ts';

/**
 * Tab contents are rendered once (via portals) into persistent host elements. A visible tab's
 * host element is moved into the tab group slot that shows it; hidden tabs are parked in an
 * invisible container. Moving a tab between groups or floating windows therefore relocates
 * DOM nodes instead of remounting React components, so editors and the diagram keep their state.
 */
export interface DockHostRegistry {
  nodes: Record<DockTabId, HTMLDivElement>;
  parking: HTMLDivElement;
}

function createRegistry(): DockHostRegistry {
  const parking = document.createElement('div');
  parking.id = 'dock-tab-parking';
  parking.style.display = 'none';

  const nodes = {} as Record<DockTabId, HTMLDivElement>;
  for (const id of DOCK_TAB_ORDER) {
    const el = document.createElement('div');
    el.className = 'absolute inset-0 flex flex-col overflow-hidden';
    el.dataset.dockTab = id;
    parking.appendChild(el);
    nodes[id] = el;
  }
  return { nodes, parking };
}

export function useDockHostRegistry(): DockHostRegistry {
  const ref = useRef<DockHostRegistry | null>(null);
  if (!ref.current) ref.current = createRegistry();
  const registry = ref.current;

  // Keep the parking container in the document so parked content stays laid out like `display: none`
  useLayoutEffect(() => {
    document.body.appendChild(registry.parking);
    return () => {
      registry.parking.remove();
    };
  }, [registry]);

  return registry;
}

interface DockTabSlotProps {
  tabId: DockTabId;
  registry: DockHostRegistry;
  className?: string;
}

/** Adopts a tab's host element while mounted, returning it to the parking container on unmount */
export const DockTabSlot: React.FC<DockTabSlotProps> = ({ tabId, registry, className = '' }) => {
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    const node = registry.nodes[tabId];
    if (!slot) return;
    slot.appendChild(node);
    return () => {
      if (node.parentElement === slot) registry.parking.appendChild(node);
    };
  }, [tabId, registry]);

  return <div ref={slotRef} className={`relative flex-1 min-h-0 min-w-0 ${className}`} data-dock-slot={tabId} />;
};
