import { EdgeDisplayProperties, EdgeLabelStyle, EdgeLinePattern } from '../types.ts';

export const EDGE_COLOR_SWATCHES = [
  { label: 'Emerald', value: '#10b981' },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Rose', value: '#f43f5e' },
  { label: 'Violet', value: '#a855f7' },
  { label: 'Slate', value: '#94a3b8' },
  { label: 'White', value: '#f8fafc' },
];

export const EDGE_WIDTH_OPTIONS = [1, 1.5, 2, 3, 4];

export const EDGE_PATTERN_OPTIONS: { value: EdgeLinePattern; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];

/** Dash pattern scaled with the line width so dashes stay visible on thick lines */
export function edgeDashArray(pattern: EdgeLinePattern, strokeWidth = 1.5): string {
  const w = Math.max(1, strokeWidth);
  if (pattern === 'dashed') return `${6 * w} ${4 * w}`;
  if (pattern === 'dotted') return `${w} ${2 * w}`;
  return 'none';
}

export const LABEL_BACKGROUND_SWATCHES = [
  { label: 'Slate', value: '#0f172a' },
  { label: 'Emerald', value: '#064e3b' },
  { label: 'Sky', value: '#0c4a6e' },
  { label: 'Amber', value: '#78350f' },
  { label: 'Rose', value: '#881337' },
  { label: 'Violet', value: '#4c1d95' },
  { label: 'Yellow', value: '#fef08a' },
  { label: 'White', value: '#ffffff' },
];

export const LABEL_TEXT_SWATCHES = [
  { label: 'White', value: '#f8fafc' },
  { label: 'Gold', value: '#fde68a' },
  { label: 'Mint', value: '#6ee7b7' },
  { label: 'Sky', value: '#7dd3fc' },
  { label: 'Coral', value: '#fda4af' },
  { label: 'Lavender', value: '#c4b5fd' },
  { label: 'Gray', value: '#94a3b8' },
  { label: 'Black', value: '#0f172a' },
];

export const LABEL_FONT_SIZE_OPTIONS = [10, 12, 14, 18, 20, 24];
export const LABEL_BORDER_WIDTH_OPTIONS = [1, 2, 3];

export function hasLabelStyle(style: EdgeLabelStyle | undefined): boolean {
  return Boolean(
    style &&
      (style.background || style.color || style.fontSize || style.bold || style.italic || style.underline || style.borderColor || style.borderWidth)
  );
}

export function hasEdgeStyle(style: EdgeDisplayProperties | undefined): boolean {
  return Boolean(style && (style.stroke || style.strokeWidth || style.pattern || hasLabelStyle(style.labelStyle)));
}

/** Drops unset / false fields so "all defaults" becomes an empty object */
export function compactStyle<T extends object>(style: T): T {
  const out = { ...style } as Record<string, unknown>;
  Object.keys(out).forEach((k) => {
    if (out[k] === undefined || out[k] === false || out[k] === 0 || out[k] === '') delete out[k];
  });
  return out as T;
}

const STYLED_ATTR = 'data-tc-edge-styled';
const MARKER_ATTRS = ['marker-end', 'marker-start'] as const;

function clearEdgeStyle(path: SVGPathElement) {
  path.style.removeProperty('stroke');
  path.style.removeProperty('stroke-width');
  path.style.removeProperty('stroke-dasharray');
  path.style.removeProperty('animation');
  for (const attr of MARKER_ATTRS) {
    const orig = path.getAttribute(`data-tc-orig-${attr}`);
    if (orig !== null) {
      path.setAttribute(attr, orig);
      path.removeAttribute(`data-tc-orig-${attr}`);
    }
  }
  path.removeAttribute(STYLED_ATTR);
}

/** Arrowheads are shared markers: point the path at a copy of its marker filled with the edge colour */
function recolorMarkers(svg: SVGSVGElement, path: SVGPathElement, color: string) {
  for (const attr of MARKER_ATTRS) {
    const current = path.getAttribute(attr);
    if (!current) continue;
    const match = current.match(/url\(#([^)]+)\)/);
    const source = match ? svg.querySelector(`marker[id="${match[1]}"]`) : null;
    if (!source) continue;
    const cloneId = `${match![1]}-tc-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
    if (!svg.querySelector(`marker[id="${cloneId}"]`)) {
      const clone = source.cloneNode(true) as SVGMarkerElement;
      clone.setAttribute('id', cloneId);
      clone.querySelectorAll<SVGElement>('path, circle, polygon, polyline, line').forEach((shape) => {
        shape.style.setProperty('fill', color, 'important');
        shape.style.setProperty('stroke', color, 'important');
      });
      source.after(clone);
    }
    path.setAttribute(`data-tc-orig-${attr}`, current);
    path.setAttribute(attr, `url(#${cloneId})`);
  }
}

/**
 * Applies custom edge styles straight to the rendered SVG (no re-render). Inline !important wins over the
 * selection / focus highlight colours, while the selection glow (filter) stays visible.
 * `styleFor` returns the style of a rendered edge path, or undefined for the theme default.
 */
export function applyEdgeStylesToSvg(
  svg: SVGSVGElement,
  styleFor: (path: SVGPathElement) => EdgeDisplayProperties | undefined
): void {
  svg.querySelectorAll<SVGPathElement>(`path[${STYLED_ATTR}]`).forEach(clearEdgeStyle);
  svg.querySelectorAll<SVGGElement>(`g.edgeLabel[${LABEL_STYLED_ATTR}]`).forEach(clearLabelStyle);

  svg.querySelectorAll<SVGPathElement>('path.tc-edge-path').forEach((path) => {
    const style = styleFor(path);
    if (!hasEdgeStyle(style)) return;
    if (hasLabelStyle(style!.labelStyle)) {
      const pathId = path.getAttribute('data-path-id') || path.id;
      svg
        .querySelectorAll<SVGGElement>(`g.edgeLabel[data-linked-path-id="${pathId}"]`)
        .forEach((label) => applyLabelStyle(label, style!.labelStyle!));
    }
    if (!(style!.stroke || style!.strokeWidth || style!.pattern)) return;
    path.setAttribute(STYLED_ATTR, 'true');
    if (style!.stroke) {
      path.style.setProperty('stroke', style!.stroke, 'important');
      recolorMarkers(svg, path, style!.stroke);
    }
    if (style!.strokeWidth) {
      path.style.setProperty('stroke-width', `${style!.strokeWidth}px`, 'important');
    }
    if (style!.pattern) {
      path.style.setProperty('stroke-dasharray', edgeDashArray(style!.pattern, style!.strokeWidth), 'important');
      // The selected-edge marching-dash animation would override a chosen pattern
      path.style.setProperty('animation', 'none', 'important');
    }
  });
}

const LABEL_STYLED_ATTR = 'data-tc-label-styled';
const LABEL_ORIG_ATTR = 'data-tc-label-orig';
const LABEL_PROPS = [
  'background-color',
  'color',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration',
  'border',
  'border-radius',
  'padding',
];

/** Label parts: the box (div.labelBkg) and the text elements inside it, which theme / highlight CSS styles directly */
function labelParts(label: SVGGElement) {
  const group = label.querySelector<SVGGElement>('g.label');
  const fo = group?.querySelector<SVGForeignObjectElement>('foreignObject') || null;
  const box = fo?.querySelector<HTMLElement>('div') || null;
  const texts = box ? Array.from(box.querySelectorAll<HTMLElement>('span, p')) : [];
  return { group, fo, box, texts };
}

function clearLabelStyle(label: SVGGElement) {
  const { group, fo, box, texts } = labelParts(label);
  const orig = label.getAttribute(LABEL_ORIG_ATTR);
  if (orig && group && fo && box) {
    const o = JSON.parse(orig) as { tf: string | null; w: string | null; h: string | null; box: string | null };
    if (o.tf !== null) group.setAttribute('transform', o.tf);
    if (o.w !== null) fo.setAttribute('width', o.w);
    if (o.h !== null) fo.setAttribute('height', o.h);
    if (o.box !== null) box.setAttribute('style', o.box);
    else box.removeAttribute('style');
  }
  texts.forEach((t) => LABEL_PROPS.forEach((p) => t.style.removeProperty(p)));
  label.removeAttribute(LABEL_ORIG_ATTR);
  label.removeAttribute(LABEL_STYLED_ATTR);
}

/**
 * Styles a guard label in place. Inline !important wins over the theme and the connected / selected highlight
 * colours (their outline still shows). The label box is re-measured so a larger font is not clipped.
 */
function applyLabelStyle(label: SVGGElement, style: EdgeLabelStyle) {
  const { group, fo, box, texts } = labelParts(label);
  if (!group || !fo || !box) return;
  const baseFontSize = parseFloat(getComputedStyle(box).fontSize) || 16;
  label.setAttribute(
    LABEL_ORIG_ATTR,
    JSON.stringify({
      tf: group.getAttribute('transform'),
      w: fo.getAttribute('width'),
      h: fo.getAttribute('height'),
      box: box.getAttribute('style'),
    })
  );
  label.setAttribute(LABEL_STYLED_ATTR, 'true');

  const set = (el: HTMLElement, prop: string, value: string) => el.style.setProperty(prop, value, 'important');
  const all = [box, ...texts];
  if (style.background) {
    set(box, 'background-color', style.background);
    texts.forEach((t) => set(t, 'background-color', 'transparent'));
  }
  if (style.color) all.forEach((el) => set(el, 'color', style.color!));
  if (style.fontSize) all.forEach((el) => set(el, 'font-size', `${style.fontSize}px`));
  if (style.bold) all.forEach((el) => set(el, 'font-weight', '700'));
  if (style.italic) all.forEach((el) => set(el, 'font-style', 'italic'));
  if (style.underline) texts.forEach((el) => set(el, 'text-decoration', 'underline'));
  if (style.borderWidth) {
    set(box, 'border', `${style.borderWidth}px solid ${style.borderColor || style.color || 'currentColor'}`);
  }
  if (style.background || style.borderWidth) {
    set(box, 'border-radius', '4px');
    set(box, 'padding', '0 4px');
  }

  // Wrapped labels have a fixed width: grow it with the font so the line breaks stay the same
  const scale = style.fontSize ? style.fontSize / baseFontSize : 1;
  if (scale !== 1) {
    for (const prop of ['width', 'max-width']) {
      const px = parseFloat(box.style.getPropertyValue(prop));
      if (px) box.style.setProperty(prop, `${px * scale}px`);
    }
  }

  // Measure the styled box with room to grow, then fit the foreignObject to it and re-centre
  // (fractional sizes: a box rounded down by even a fraction of a pixel wraps the text onto a second line)
  fo.setAttribute('width', '4000');
  fo.setAttribute('height', '4000');
  const foRect = fo.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();
  const unitX = foRect.width / 4000 || 1;
  const unitY = foRect.height / 4000 || 1;
  const w = Math.ceil(boxRect.width / unitX) + 1;
  const h = Math.ceil(boxRect.height / unitY) + 1;
  fo.setAttribute('width', String(w));
  fo.setAttribute('height', String(h));
  group.setAttribute('transform', `translate(${-w / 2}, ${-h / 2})`);
}
