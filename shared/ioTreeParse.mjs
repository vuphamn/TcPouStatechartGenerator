// The PLC's I/O tree (read-only), as its TwinCAT project describes it: each I/O device (_Config/IO/*.xti: an
// EtherCAT master, …) with its boxes nested as they are wired (couplers EK1200 / EK1100 / EK1122, terminals EL…, EP…),
// each box's PDOs and their entries; and the links of the PLC's variables to them (the PLC instance's .xti:
// <OwnerA Name="InputDst" / "OutputSrc"><OwnerB Name="TIID^device^box^…"><Link VarA="MAIN.x" VarB="Channel 6^Input"/>).
// From CurrentConfig.tszip (the PLC's boot folder) or a project folder's files: { path: text }.
// One module for both sides: Node (shared/tcIoTree.cjs, with xmldom) and the browser (its own DOMParser), each giving
// parseXml (text -> Document).

const kids = (el, name) => (el ? Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.nodeName === name) : []);
const kid = (el, name) => kids(el, name)[0] ?? null;
const textOf = (el) => (el?.textContent ?? '').trim();
/** A box's product: the last "(…)" of its name, e.g. "Main (EK1200)" -> EK1200 */
export const productOf = (name) => name.match(/\(([^()]+)\)\s*$/)?.[1] ?? '';
const base = (p) => p.split(/[\\/]/).pop().replace(/\.xti$/i, '');
const hex = (v) => {
  const m = /^#x([0-9a-f]+)$/i.exec(String(v || '').trim());
  return m ? parseInt(m[1], 16) >>> 0 : null;
};

/**
 * Where a box's port A is cabled, from its PortABoxInfo (#xPPBBBBBB: the port P (0 … 3: A … D) of the box of Id B;
 * #x00ffffff: the master): { box, port } or { master: true }
 */
export function portAOf(info) {
  const v = hex(info);
  if (v === null) return null;
  const box = v & 0xffffff;
  if (box === 0xffffff) return { master: true, port: 0 };
  return { box, port: (v >>> 24) & 0xff };
}

/**
 * The devices of the I/O configuration: [{ name, netId, disabled?, boxes: [{ name, product, path, id, slave, address,
 * portA, info, disabled?, boxes, pdos: [{ name, dir: 'in' | 'out', entries: [{ name, type, path, link? }] }] }] }];
 * links: [{ path, variable, type, dir }] (path: "device^box^…^pdo^entry", as TwinCAT names it; variable: the PLC's
 * symbol, e.g. MAIN.fb.bIn). A box's id: its Box Id; slave: its place among the master's slaves (the boxes in the order
 * the project lists them, the disabled ones left out); address: its EtherCAT address as TwinCAT gives it by default
 * (1000 + its Id); info: what the project says of the device (its ESI type and name, vendor, product code, revision)
 */
export function parseIoTreeWith(files, parseXml) {
  const devices = [];
  const links = [];
  for (const [p, text] of Object.entries(files)) {
    if (!/\.(xti|tsproj)$/i.test(p)) continue;
    let doc;
    try {
      doc = parseXml(String(text).replace(/^﻿/, ''));
    } catch {
      continue;
    }
    const root = doc?.documentElement;
    if (!root) continue;
    // An I/O device: its boxes nested (an .xti's own; a .tsproj's in its <Io>, not those kept in an .xti: File="…")
    const devs = /\.tsproj$/i.test(p)
      ? Array.from(root.getElementsByTagName('Device')).filter((d) => d.parentNode?.nodeName === 'Io' && !d.getAttribute('File'))
      : kids(root, 'Device');
    for (const dev of devs) {
      const named = textOf(kid(dev, 'Name'));
      const name = dev.getAttribute('RemoteName') || (named && named !== '__FILENAME__' ? named : base(p));
      let slave = 0;
      const boxOf = (el, parent) => {
        const bname = textOf(kid(el, 'Name'));
        const disabled = el.getAttribute('Disabled') === 'true';
        const order = disabled ? null : slave++;
        const path = `${parent}^${bname}`;
        const ec = kid(el, 'EtherCAT');
        const pdos = kids(ec ?? el, 'Pdo').map((pdo) => {
          const pname = pdo.getAttribute('Name') || '';
          return {
            name: pname,
            dir: pdo.getAttribute('InOut') === '1' ? 'out' : 'in',
            entries: kids(pdo, 'Entry')
              .map((en) => ({ name: en.getAttribute('Name') || '', type: textOf(kid(en, 'Type')), path: `${path}^${pname}^${en.getAttribute('Name') || ''}` }))
              .filter((en) => en.name),
          };
        }).filter((x) => x.entries.length);
        const id = Number(el.getAttribute('Id'));
        const hasId = Number.isFinite(id) && !!el.getAttribute('Id');
        const portA = portAOf(ec?.getAttribute('PortABoxInfo'));
        const info = ec
          ? Object.fromEntries(
              Object.entries({
                type: ec.getAttribute('Type') || '',
                desc: ec.getAttribute('Desc') || '',
                vendorId: hex(ec.getAttribute('VendorId')),
                productCode: ec.getAttribute('ProductCode') || '',
                revision: ec.getAttribute('RevisionNo') || '',
                supplier: textOf(kid(ec, 'SuName')),
              }).filter(([, v]) => v !== '' && v !== null)
            )
          : null;
        return {
          name: bname,
          product: productOf(bname),
          path,
          ...(hasId ? { id, address: 1000 + id } : {}),
          slave: order,
          ...(portA ? { portA } : {}),
          ...(info && Object.keys(info).length ? { info } : {}),
          ...(disabled ? { disabled: true } : {}),
          boxes: kids(el, 'Box').map((b) => boxOf(b, path)),
          pdos,
        };
      };
      devices.push({ name, netId: dev.getAttribute('AmsNetId') || null, ...(dev.getAttribute('Disabled') === 'true' ? { disabled: true } : {}), boxes: kids(dev, 'Box').map((b) => boxOf(b, name)) });
    }
    // The PLC's links: its variables to the boxes' entries
    // (InputDst / OutputSrc: VarA the variable itself; the project's own mappings, no name: VarA "<task> Inputs^MAIN.x"
    // or "… Outputs^…"; other VarA, e.g. an NC axis' "Drive^Inputs^In^nState1": not a PLC variable, left out)
    const ownersA = root.getElementsByTagName('OwnerA');
    for (let i = 0; i < ownersA.length; i++) {
      const ownerA = ownersA[i];
      const kind = ownerA.getAttribute('Name');
      if (kind && kind !== 'InputDst' && kind !== 'OutputSrc') continue;
      for (const ownerB of kids(ownerA, 'OwnerB')) {
        const box = (ownerB.getAttribute('Name') || '').replace(/^TIID\^/, '');
        if (!box || box === (ownerB.getAttribute('Name') || '')) continue;
        for (const l of kids(ownerB, 'Link')) {
          const varA = l.getAttribute('VarA');
          const entry = l.getAttribute('VarB');
          if (!varA || !entry) continue;
          let variable = varA;
          let dir = kind === 'OutputSrc' ? 'out' : 'in';
          if (!kind) {
            const m = varA.match(/^[^^]*\b(Inputs|Outputs)\^([A-Za-z_][\w.[\]]*)$/);
            if (!m) continue;
            variable = m[2];
            dir = m[1] === 'Inputs' ? 'in' : 'out';
          }
          links.push({ path: `${box}^${entry}`, box, entry, variable, type: l.getAttribute('TypeA') || '', dir });
        }
      }
    }
  }
  // Each entry's link (its PLC variable), and the links whose entry was not found (shown under their box path)
  const byPath = new Map(links.map((l) => [l.path, l]));
  const walk = (boxes) => {
    for (const b of boxes) {
      for (const pdo of b.pdos) for (const en of pdo.entries) {
        const l = byPath.get(en.path);
        if (l) en.link = l.variable;
      }
      walk(b.boxes);
    }
  };
  for (const d of devices) walk(d.boxes);
  // (a link to an item that is no PDO entry here, e.g. a terminal's InfoData^State: listed on its box as one)
  const boxes = new Map();
  const index = (bs) => bs.forEach((b) => (boxes.set(b.path, b), index(b.boxes)));
  for (const d of devices) index(d.boxes);
  const placed = new Set();
  const mark = (bs) => bs.forEach((b) => (b.pdos.forEach((p) => p.entries.forEach((en) => en.link && placed.add(en.path))), mark(b.boxes)));
  for (const d of devices) mark(d.boxes);
  for (const l of links) {
    if (placed.has(l.path)) continue;
    const b = boxes.get(l.box);
    if (!b) continue;
    let other = b.pdos.find((p) => p.name === '(other links)');
    if (!other) b.pdos.push((other = { name: '(other links)', dir: l.dir, entries: [] }));
    other.entries.push({ name: l.entry.replace(/\^/g, ' / '), type: l.type, path: l.path, link: l.variable });
    placed.add(l.path);
  }
  return { devices, links };
}

/** A TwinCAT project folder's files for its I/O tree (offline): its .tsproj, its _Config's .xti files */
export const IO_FILE = /(^|\/)_Config\/.*\.xti$|\.tsproj$/i;
