// Change control: each change of a PLC's program the gateway sees (projectSync.cjs: another build downloaded, or an
// online change; the files that changed), kept as a change to explain: why (a reason, a work order) by an engineer,
// then approved by a supervisor or another engineer (not the one who explained it, when roles are on). Unexplained
// and unapproved ones are counted on the board; each one is told to the roles that want "change". Kept in
// changes.json beside config.json (the last 1000).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createChanges({ baseDir, log, audit, notify, rolesOn }) {
  const file = path.join(baseDir, 'changes.json');
  let list = [];
  try {
    const x = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(x)) list = x;
  } catch {
    list = [];
  }
  const listeners = new Set();
  const save = () => {
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(list.slice(-1000), null, 1));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      log(`changes: ${err.message}`);
    }
    for (const fn of listeners) fn();
  };
  const of = (id) => {
    const c = list.find((x) => x.id === id);
    if (!c) throw new Error('No such change');
    return c;
  };
  return {
    /** A change seen: { plc, plcName, kind: 'download' | 'online change' | 'no sources', project, files, onlineChanges, appTimestamp } */
    add(ch) {
      const c = {
        id: crypto.randomBytes(5).toString('hex'), at: Date.now(), plc: ch.plc, plcName: ch.plcName ?? ch.plc, kind: ch.kind, project: ch.project ?? '',
        files: (ch.files ?? []).slice(0, 100), fileCount: ch.files?.length ?? 0, onlineChanges: ch.onlineChanges ?? null, appTimestamp: ch.appTimestamp ?? null, unit: ch.unit === 'setting' ? 'setting' : 'file',
        reason: '', workOrder: null, explainedBy: null, explainedAt: null, approvedBy: null, approvedAt: null,
      };
      list.push(c);
      if (list.length > 1000) list = list.slice(-1000);
      save();
      log(`changes: ${c.plcName}: ${c.kind}${c.fileCount ? ` (${c.fileCount} ${c.unit}(s) changed)` : ''}: to be explained`);
      notify?.({ event: 'change', plc: c.plc, plcName: c.plcName, machine: '', state: c.kind, at: new Date(c.at).toISOString(), text: ch.text ?? `${c.plcName}: 🧾 its PLC program changed (${c.kind}${c.fileCount ? `, ${c.fileCount} file(s)` : ''}): not explained yet` });
      return c;
    },
    /** Why: its reason, its work order (an engineer) */
    explain(id, { reason, workOrder }, user) {
      const c = of(id);
      const r = String(reason ?? '').trim().slice(0, 1000);
      if (!r) throw new Error('Why it was changed: its reason');
      if (c.approvedBy) throw new Error('Approved already');
      Object.assign(c, { reason: r, workOrder: workOrder ? String(workOrder).slice(0, 40) : null, explainedBy: user, explainedAt: Date.now() });
      save();
      audit?.add(user, 'change.explain', { id, plc: c.plc, reason: r.slice(0, 200) });
      return c;
    },
    /** Approved (a supervisor, an engineer; not the one who explained it, with roles on) */
    approve(id, user) {
      const c = of(id);
      if (!c.explainedBy) throw new Error('Explain it first: why it was changed');
      if (c.approvedBy) throw new Error(`Approved already by ${c.approvedBy}`);
      if (rolesOn() && c.explainedBy === user) throw new Error('Approved by another person than the one who explained it');
      Object.assign(c, { approvedBy: user, approvedAt: Date.now() });
      save();
      audit?.add(user, 'change.approve', { id, plc: c.plc });
      return c;
    },
    list: (limit = 200) => list.slice(-limit).reverse(),
    open: () => list.filter((c) => !c.approvedBy).length,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Which kind of change: the fingerprints before and now ({ appTimestamp, onlineChanges }) */
function kindOf(before, now, sources = true) {
  if (!sources) return 'no sources';
  if (before && now && before.appTimestamp === now.appTimestamp && Number(now.onlineChanges) > Number(before.onlineChanges)) return 'online change';
  return 'download';
}

/** The files that changed between two manifests ({ path: sha }) */
function filesChanged(before = {}, now = {}) {
  const out = [];
  for (const [p, h] of Object.entries(now)) if (before[p] !== h) out.push(before[p] === undefined ? `+ ${p}` : `~ ${p}`);
  for (const p of Object.keys(before)) if (!(p in now)) out.push(`- ${p}`);
  return out.sort((a, b) => a.slice(2).localeCompare(b.slice(2)));
}

module.exports = { createChanges, kindOf, filesChanged };
