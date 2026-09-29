/**
 * Where the caret (or the word at it) is on screen in a code editor's textarea: an inline field is put there (Shift+F6
 * Rename). Monospace text, tabs of 4, the textarea's padding and scroll.
 */
export function caretAnchor(ta: HTMLTextAreaElement, at = ta.selectionStart, wordLength = 0): { x: number; y: number; width: number; height: number } {
  const style = getComputedStyle(ta);
  const lineH = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 18;
  let charW = parseFloat(style.fontSize) * 0.6 || 8;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = `${style.fontSize} ${style.fontFamily}`;
      charW = ctx.measureText('MMMMMMMMMM').width / 10 || charW;
    }
  } catch {
    // (no canvas: the estimate)
  }
  const before = ta.value.slice(0, at).split('\n');
  const line = before.length - 1;
  let col = 0;
  for (const ch of before[before.length - 1]) col = ch === '\t' ? col + 4 - (col % 4) : col + 1;
  const r = ta.getBoundingClientRect();
  const x = r.left + (parseFloat(style.paddingLeft) || 0) + col * charW - ta.scrollLeft;
  const y = r.top + (parseFloat(style.paddingTop) || 0) + line * lineH - ta.scrollTop;
  const width = Math.max(wordLength, 4) * charW;
  // (the anchor's middle: the field is centred on it)
  return { x: Math.max(r.left, Math.min(r.right, x + width / 2)), y: Math.max(r.top, Math.min(r.bottom, y + lineH / 2)), width, height: lineH };
}
