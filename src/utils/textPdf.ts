/**
 * A plain PDF of text lines (the commissioning report as PDF): A4 pages, Helvetica, long lines wrapped; the first
 * line bold (the title). Only ASCII is written (others replaced: → as ->, – as -, ✓ as v, the rest ?), so the file
 * can travel as text (the hosts' Save writes text) and stays a valid PDF.
 */
const ASCII: Record<string, string> = { '→': '->', '←': '<-', '–': '-', '—': '-', '✓': 'v', '✗': 'x', '·': '-', '…': '...', '’': "'", '‘': "'", '“': '"', '”': '"', 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss', 'é': 'e', 'è': 'e', 'à': 'a', '\t': '    ' };
export const pdfAscii = (s: string) => [...s].map((c) => ASCII[c] ?? (c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 ? c : '?')).join('');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** The lines as a PDF document (a string of ASCII) */
export function textPdf(lines: string[], opts: { size?: number; wrap?: number } = {}): string {
  const size = opts.size ?? 9;
  const wrap = opts.wrap ?? 110;
  const leading = Math.round(size * 1.35);
  const perPage = Math.floor((842 - 80) / leading);
  // (wrapped at word breaks; the first line stays the title)
  const all: { text: string; bold: boolean }[] = [];
  lines.forEach((raw, i) => {
    let rest = pdfAscii(raw);
    // (each piece moves on: a break at a space in its second half, else cut where it is full; continuations indented)
    for (let first = true; ; first = false) {
      const room = first ? wrap : wrap - 4;
      const prefix = first ? '' : '    ';
      if (rest.length <= room) {
        all.push({ text: prefix + rest, bold: i === 0 });
        break;
      }
      let cut = rest.lastIndexOf(' ', room);
      if (cut < room / 2) cut = room;
      all.push({ text: prefix + rest.slice(0, cut), bold: i === 0 });
      rest = rest.slice(cut).replace(/^ +/, '');
      if (!rest) break;
    }
  });
  const pages: { text: string; bold: boolean }[][] = [];
  for (let i = 0; i < all.length; i += perPage) pages.push(all.slice(i, i + perPage));
  if (!pages.length) pages.push([]);
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  pages.forEach((page, p) => {
    const body = [`BT /F1 ${size} Tf ${leading} TL 40 802 Td`, ...page.map((l) => `${l.bold ? `/F2 ${size + 3} Tf` : `/F1 ${size} Tf`} (${esc(l.text)}) Tj T*`), `/F1 7 Tf 0 ${-leading} Td (Page ${p + 1} of ${pages.length}) Tj`, 'ET'].join('\n');
    const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
