// The TwinCAT project's I/O (as XAE's Solution Explorer shows it under I/O > Devices), read from the files only (no
// vscode: tested on its own): the .tsproj's <Io> lists each device, inline or in its own file (_Config/IO/<file>.xti,
// "independent project files"); a device's boxes (EtherCAT couplers, terminals, drives) are its <Box> elements, nested
// as on the bus. Disabled: the attribute Disabled="true" on the <Device> or <Box> start tag (what XAE writes for
// Disable; the Automation Interface's ITcSmTreeItem.Disabled, DISABLED_STATE: SMDS_DISABLED); a disabled one's children
// are disabled with it (SMDS_PARENT_DISABLED). Disable / Enable here: that attribute put in or taken out, nothing else
// of the file touched (its BOM, line ends, the rest as it was).
const fs = require('fs');
const path = require('path');

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/**
 * The devices and boxes of an XML text (a .tsproj's <Io>, or a device's .xti): [{ kind, id, name, type, disabled,
 * file (the device's own .xti, when it has one), children }]. A device without an Id (a drive's inside its box) is not
 * one of the tree's: skipped, its depth counted.
 */
function parseIo(xml, { file, fileName } = {}) {
  const top = [];
  const stack = [];
  const rx = /<(\/?)(Device|Box)\b([^>]*?)(\/?)>|<Name>([^<]*)<\/Name>/g;
  let m;
  while ((m = rx.exec(xml))) {
    if (m[5] !== undefined) {
      const cur = stack[stack.length - 1];
      if (cur && cur.node && cur.node.name === undefined) cur.node.name = unescapeXml(m[5]);
      continue;
    }
    const [, closing, kind, attrs, selfClosing] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    const id = attr(attrs, 'Id');
    const node = id === undefined ? null : { kind: kind.toLowerCase(), id, name: undefined, type: attr(attrs, kind === 'Box' ? 'BoxType' : 'DevType'), disabled: /\bDisabled="true"/.test(attrs), file, children: [], ...(attr(attrs, 'File') ? { ownFile: attr(attrs, 'File') } : {}) };
    // (an element inside a skipped one is skipped too)
    const parent = stack.length ? stack[stack.length - 1] : null;
    const keep = node && (!parent || parent.node);
    if (keep) (parent ? parent.node.children : top).push(node);
    if (!selfClosing) stack.push({ node: keep ? node : null });
  }
  // (a device's file names it "__FILENAME__": XAE shows the file's name)
  const name = (n) => {
    if (n.name === undefined || n.name === '__FILENAME__') n.name = n.ownFile ? n.ownFile.replace(/\.xti$/i, '') : n.name === '__FILENAME__' && fileName ? fileName.replace(/\.xti$/i, '') : n.name ?? `${n.kind === 'device' ? 'Device' : 'Box'} ${n.id}`;
    n.children.forEach(name);
  };
  top.forEach(name);
  return top;
}

/** The disabled state of each node: its own, or its parent's (SMDS_PARENT_DISABLED) */
function markParents(nodes, parentDisabled = null) {
  for (const n of nodes) {
    n.parentDisabled = parentDisabled;
    markParents(n.children, n.disabled ? n.name : parentDisabled);
  }
  return nodes;
}

/** The project's I/O devices (its .tsproj's <Io>; a device in its own file read from _Config/IO) */
function readIoTree(tsproj) {
  const xml = fs.readFileSync(tsproj, 'utf8');
  const io = xml.match(/<Io\b[^>]*>([\s\S]*?)<\/Io>/);
  if (!io) return [];
  const devices = parseIo(io[1], { file: tsproj }).filter((n) => n.kind === 'device');
  const out = devices.map((d) => {
    if (!d.ownFile) return d;
    const own = path.join(path.dirname(tsproj), '_Config', 'IO', d.ownFile);
    try {
      const inFile = parseIo(fs.readFileSync(own, 'utf8'), { file: own, fileName: d.ownFile }).find((n) => n.kind === 'device');
      return inFile ? { ...inFile, ownFile: d.ownFile, file: own } : { ...d, missing: own };
    } catch {
      return { ...d, missing: own };
    }
  });
  return markParents(out);
}

/**
 * A device or box disabled (true) or enabled (false) in its file: Disabled="true" put after its Id (where XAE puts it)
 * or taken out of its start tag; the rest of the file as it was. → { ok, changed } or { ok: false, error }
 */
function setDisabled(file, kind, id, disabled) {
  const tag = kind === 'device' ? 'Device' : 'Box';
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { ok: false, error: `${path.basename(file)} not read: ${err.message}` };
  }
  const rx = new RegExp(`<${tag}\\b[^>]*\\bId="${String(id).replace(/[^\w-]/g, '')}"[^>]*>`, 'g');
  const found = [...text.matchAll(rx)];
  if (found.length !== 1) return { ok: false, error: found.length ? `${tag} ${id} is in ${path.basename(file)} ${found.length} times: not changed` : `${tag} ${id} not found in ${path.basename(file)}` };
  const start = found[0][0];
  const has = /\sDisabled="true"/.test(start);
  if (has === disabled) return { ok: true, changed: false };
  const next = disabled ? start.replace(new RegExp(`(\\bId="${id}")`), '$1 Disabled="true"') : start.replace(/\s+Disabled="true"/, '');
  const at = found[0].index;
  try {
    fs.writeFileSync(file, text.slice(0, at) + next + text.slice(at + start.length));
  } catch (err) {
    return { ok: false, error: `${path.basename(file)} not written: ${err.message}` };
  }
  return { ok: true, changed: true };
}

module.exports = { parseIo, readIoTree, setDisabled, markParents };
