import { RefObject, useLayoutEffect, useRef, useState } from 'react';

export interface ToolbarOverflowOptions<T extends string> {
  /** Controls that currently apply, in visual order */
  items: T[];
  /** Controls in keep-visible order: the first entries are the last to move into the Hidden menu */
  priority: T[];
  /** Pixels available for the controls (including the Hidden button when it is needed) */
  available: number;
  /** Element containing the controls, each wrapped in an element with `data-toolbar-item="<id>"` */
  containerRef: RefObject<HTMLElement | null>;
  /** Selector (inside the container) of the Hidden button, measured when shown */
  hiddenButtonSelector: string;
  /** Visual group of a control; a separator is drawn where the group changes */
  groupOf?: (id: T) => number;
  gap?: number;
  separatorWidth?: number;
  initialHiddenButtonWidth?: number;
}

export interface ToolbarOverflowResult<T extends string> {
  /** Controls that do not fit, in visual order */
  overflow: T[];
  /** Last measured width of the Hidden button */
  hiddenButtonWidth: number;
  isVisible: (id: T) => boolean;
}

/**
 * Priority overflow for a single-row toolbar: measures each control while it is shown and moves the
 * lowest-priority controls that do not fit into a "Hidden" menu. Hidden controls keep their last
 * measured width, so they come back as soon as there is room again.
 */
export function useToolbarOverflow<T extends string>({
  items,
  priority,
  available,
  containerRef,
  hiddenButtonSelector,
  groupOf,
  gap = 6,
  separatorWidth = 8,
  initialHiddenButtonWidth = 96,
}: ToolbarOverflowOptions<T>): ToolbarOverflowResult<T> {
  const widthsRef = useRef<Partial<Record<T, number>>>({});
  const hiddenButtonWidthRef = useRef<number>(initialHiddenButtonWidth);
  const [overflow, setOverflow] = useState<T[]>([]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || available <= 0) return;

    container.querySelectorAll<HTMLElement>('[data-toolbar-item]').forEach((el) => {
      if (el.offsetWidth > 0) widthsRef.current[el.dataset.toolbarItem as T] = el.offsetWidth;
    });
    const hiddenButton = container.querySelector<HTMLElement>(hiddenButtonSelector);
    if (hiddenButton && hiddenButton.offsetWidth > 0) hiddenButtonWidthRef.current = hiddenButton.offsetWidth;

    const width = (id: T) => widthsRef.current[id] ?? 90;
    const cost = (ids: T[]) => {
      const groups = groupOf ? new Set(ids.map(groupOf)).size : 1;
      return ids.reduce((sum, id) => sum + width(id) + gap, 0) + Math.max(0, groups - 1) * separatorWidth;
    };

    const candidates = priority.filter((id) => items.includes(id));
    let visible = candidates;
    if (cost(candidates) > available) {
      visible = [];
      for (const id of candidates) {
        if (cost([...visible, id]) <= available - hiddenButtonWidthRef.current - gap) visible.push(id);
      }
    }
    const next = items.filter((id) => !visible.includes(id));
    setOverflow((prev) => (prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next));
  });

  return {
    overflow,
    hiddenButtonWidth: hiddenButtonWidthRef.current,
    isVisible: (id: T) => items.includes(id) && !overflow.includes(id),
  };
}
