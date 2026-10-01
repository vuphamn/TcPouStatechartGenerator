// The PLC's I/O configuration compared with a TwinCAT project's (the I/O tab's Compare): boxes only on one side, and
// boxes on both whose device differs (its type, product code or revision) or that are cabled elsewhere
import type { IoBox, IoTree } from '../components/IoTreePanel.tsx';
import { allBoxes } from '../components/IoNetworkView.tsx';

export interface IoDifference {
  kind: 'only-plc' | 'only-project' | 'device' | 'cabling';
  /** The box's path (device^box^…) */
  path: string;
  name: string;
  text: string;
}

const typeOf = (b: IoBox) => (b.info?.type || b.product || '').split(/[\s,;]+/)[0];
const cabling = (b: IoBox, ids: Map<number, IoBox>) =>
  b.portA?.master ? 'the master' : b.portA?.box !== undefined ? `${ids.get(b.portA.box)?.name ?? `box ${b.portA.box}`}, port ${'ABCD'[b.portA.port] ?? b.portA.port}` : '';

/** What differs between the PLC's I/O (plc) and the project's (project), by box path; in the PLC's order */
export function compareIoTrees(plc: IoTree, project: IoTree): IoDifference[] {
  const index = (t: IoTree) => {
    const boxes = new Map<string, IoBox>();
    const ids = new Map<string, Map<number, IoBox>>();
    for (const d of t.devices) {
      const all = allBoxes(d.boxes);
      const byId = new Map(all.filter((b) => b.id !== undefined).map((b) => [b.id!, b]));
      for (const b of all) {
        boxes.set(b.path, b);
        ids.set(b.path, byId);
      }
    }
    return { boxes, ids };
  };
  const a = index(plc);
  const b = index(project);
  const out: IoDifference[] = [];
  for (const [path, x] of a.boxes) {
    const y = b.boxes.get(path);
    if (!y) {
      out.push({ kind: 'only-plc', path, name: x.name, text: `${x.name}: on the PLC, not in the project` });
      continue;
    }
    const what: string[] = [];
    if (typeOf(x) !== typeOf(y)) what.push(`type ${typeOf(x) || '?'} on the PLC, ${typeOf(y) || '?'} in the project`);
    else if ((x.info?.productCode ?? '') !== (y.info?.productCode ?? '')) what.push(`product code ${x.info?.productCode ?? '?'} on the PLC, ${y.info?.productCode ?? '?'} in the project`);
    if ((x.info?.revision ?? '') !== (y.info?.revision ?? '')) what.push(`revision ${x.info?.revision ?? '?'} on the PLC, ${y.info?.revision ?? '?'} in the project`);
    if (!!x.disabled !== !!y.disabled) what.push(x.disabled ? 'disabled on the PLC' : 'disabled in the project');
    if (what.length) out.push({ kind: 'device', path, name: x.name, text: `${x.name}: ${what.join('; ')}` });
    const ca = cabling(x, a.ids.get(path)!);
    const cb = cabling(y, b.ids.get(path)!);
    if (ca && cb && ca !== cb) out.push({ kind: 'cabling', path, name: x.name, text: `${x.name}: port A to ${ca} on the PLC, to ${cb} in the project` });
  }
  for (const [path, y] of b.boxes) if (!a.boxes.has(path)) out.push({ kind: 'only-project', path, name: y.name, text: `${y.name}: in the project, not on the PLC` });
  return out;
}
