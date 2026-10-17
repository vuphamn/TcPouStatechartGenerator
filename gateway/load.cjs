// The setup page's load panel: what the gateway costs the computer it runs on and the PLCs it reads, measured.
// - This computer: the whole machine's CPU (all programs: the PLC's Windows side, KvalCAM, browsers …), the gateway's
//   own CPU and memory, its event loop's delay (a busy gateway answers late);
// - each PLC: its shared ADS notifications (sharedVars.cjs: boards, alarms, recordings, I/O signals, 10 ms on
//   change) and the samples they bring per second; the live sessions' own (diagrams live, 1 ms); the viewers;
// - each PLC's tasks (TwinCAT_SystemInfoVarList._TaskInfo[1..4]): cycle time, last execution time (read every 2 s;
//   the longest seen since the gateway started), CycleTimeExceeded and RTViolation followed on change: each overrun
//   counted (since the start, and in the last hour).
// Sampled every 2 seconds; the task watch only while the PLC's connection is open (boards, alarms, recordings, live).
const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');

const EVERY_MS = 2000;
const TASKS = [1, 2, 3, 4];
const TI = 'TwinCAT_SystemInfoVarList._TaskInfo';

// - each PLC's clock: its first task's DcTaskTime (ns since 2000-01-01, the PLC's own time) against the gateway's,
//   once a minute: its offset, its drift a day (the last 24 hours); an offset over config.clock.maxOffsetMs (2 s) an
//   alert ("clock"), once a day a PLC: its events and the gateway's no longer line up
const DC_EPOCH_MS = Date.UTC(2000, 0, 1);

/** Its drift (ms a day) from its offsets [{ t, offsetMs }]: their slope (least squares), at least 30 minutes of them */
function driftOf(samples) {
  if (samples.length < 3 || samples[samples.length - 1].t - samples[0].t < 30 * 60000) return null;
  const n = samples.length;
  const mt = samples.reduce((a, x) => a + x.t, 0) / n;
  const mo = samples.reduce((a, x) => a + x.offsetMs, 0) / n;
  let num = 0;
  let den = 0;
  for (const x of samples) {
    num += (x.t - mt) * (x.offsetMs - mo);
    den += (x.t - mt) ** 2;
  }
  return den ? (num / den) * 86400000 : null;
}

function createLoad({ connections, plcOf, plcList, ads, log, getConfig, onEvent }) {
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  let prevCpu = process.cpuUsage();
  let prevAt = process.hrtime.bigint();
  let prevSys = os.cpus().map((c) => c.times);
  const proc = { cpuPct: 0, machinePct: 0, rssMB: 0, heapMB: 0, loopP99Ms: 0, loopMaxMs: 0 };
  const perPlc = new Map(); // plc id -> { client, watcher, tasks: Map(index -> task), prevSamples, prevAt, samplesPerSec }
  const started = Date.now();

  const sampleProcess = () => {
    const now = process.hrtime.bigint();
    const us = Number(now - prevAt) / 1000;
    const cpu = process.cpuUsage(prevCpu);
    prevCpu = process.cpuUsage();
    prevAt = now;
    // (the gateway: of one core; the machine: all cores, every program)
    proc.cpuPct = us > 0 ? ((cpu.user + cpu.system) / us) * 100 : 0;
    const sys = os.cpus().map((c) => c.times);
    let busy = 0;
    let total = 0;
    sys.forEach((t, i) => {
      const p = prevSys[i] ?? t;
      const b = t.user - p.user + t.nice - p.nice + t.sys - p.sys + t.irq - p.irq;
      busy += b;
      total += b + (t.idle - p.idle);
    });
    prevSys = sys;
    proc.machinePct = total > 0 ? (busy / total) * 100 : 0;
    const m = process.memoryUsage();
    proc.rssMB = m.rss / 1048576;
    proc.heapMB = m.heapUsed / 1048576;
    proc.loopP99Ms = loop.percentile(99) / 1e6;
    proc.loopMaxMs = loop.max / 1e6;
    loop.reset();
  };

  /** A PLC's task watch on its open connection (a new connection: a new watch) */
  const watchTasks = (id, conn) => {
    let s = perPlc.get(id);
    if (s && s.client === conn.client) return s;
    s?.watcher?.close().catch(() => {});
    s = { client: conn.client, watcher: null, tasks: new Map(), prevSamples: null, prevAt: Date.now(), samplesPerSec: 0, handles: new Map(), busy: false, clock: s?.clock ?? { offsetMs: null, at: 0, samples: [], told: '' } };
    perPlc.set(id, s);
    const shared = conn.sharedVars?.();
    if (shared) {
      s.watcher = shared.watcher(() => {});
      void s.watcher.set(TASKS.flatMap((i) => [
        { id: `${i}:name`, candidates: [`${TI}[${i}].TaskName`] },
        { id: `${i}:cycle`, candidates: [`${TI}[${i}].CycleTime`] },
        { id: `${i}:over`, candidates: [`${TI}[${i}].CycleTimeExceeded`] },
        { id: `${i}:rt`, candidates: [`${TI}[${i}].RTViolation`] },
      ]));
    }
    return s;
  };

  const taskOf = (s, i) => {
    if (!s.tasks.has(i)) s.tasks.set(i, { index: i, name: '', cycleUs: null, execUs: null, maxExecUs: 0, overruns: 0, overrunTimes: [], exceeded: false, rtViolations: 0, rtViolation: false });
    return s.tasks.get(i);
  };

  const sampleTasks = async (id, s) => {
    for (const x of s.watcher?.drain() ?? []) {
      const [i, what] = x.id.split(':');
      const t = taskOf(s, Number(i));
      if (what === 'name') t.name = String(x.v ?? '');
      else if (what === 'cycle') t.cycleUs = Number(x.v) / 10;
      else if (what === 'over') {
        if (x.v === true && !t.exceeded) {
          t.overruns++;
          t.overrunTimes.push(x.t || Date.now());
        }
        t.exceeded = x.v === true;
      } else if (what === 'rt') {
        if (x.v === true && !t.rtViolation) t.rtViolations++;
        t.rtViolation = x.v === true;
      }
    }
    // (the last execution time: read, not followed: it changes every cycle)
    if (s.busy) return;
    s.busy = true;
    try {
      for (const t of s.tasks.values()) {
        if (!t.name) continue;
        const p = `${TI}[${t.index}].LastExecTime`;
        try {
          let h = s.handles.get(p);
          if (h === undefined) {
            h = await ads.createHandle(s.client, p);
            s.handles.set(p, h);
          }
          const v = Number(await ads.readByHandle(s.client, h, 4));
          t.execUs = v / 10;
          t.maxExecUs = Math.max(t.maxExecUs, t.execUs);
        } catch {
          s.handles.delete(p);
        }
      }
      // (its clock, once a minute)
      if (Date.now() - s.clock.at >= 60000) await sampleClock(id, s);
    } finally {
      s.busy = false;
    }
    const hour = Date.now() - 3600_000;
    for (const t of s.tasks.values()) while (t.overrunTimes.length && t.overrunTimes[0] < hour) t.overrunTimes.shift();
  };

  /** Its clock: the first task's DcTaskTime, the gateway's time halfway through the read */
  const sampleClock = async (id, s) => {
    s.clock.at = Date.now();
    const first = [...s.tasks.values()].filter((t) => t.name).sort((a, b) => a.index - b.index)[0];
    const p = `${TI}[${first?.index ?? 1}].DcTaskTime`;
    try {
      let h = s.handles.get(p);
      if (h === undefined) {
        h = await ads.createHandle(s.client, p);
        s.handles.set(p, h);
      }
      const t0 = Date.now();
      const buf = await s.client.readRaw(0xf005, h, 8);
      const t1 = Date.now();
      const plcMs = Number(buf.readBigInt64LE(0) / 1000000n) + DC_EPOCH_MS;
      const offsetMs = plcMs - (t0 + t1) / 2;
      s.clock.offsetMs = Math.round(offsetMs);
      s.clock.samples.push({ t: t1, offsetMs });
      while (s.clock.samples.length && s.clock.samples[0].t < t1 - 86400000) s.clock.samples.shift();
      const max = Math.max(100, Number(getConfig?.()?.clock?.maxOffsetMs) || 2000);
      const day = new Date().toDateString();
      if (Math.abs(offsetMs) > max && s.clock.told !== day) {
        s.clock.told = day;
        const plc = plcOf(id);
        const text = `${plc?.name ?? id}: 🕒 its clock is ${(Math.abs(offsetMs) / 1000).toFixed(1)} s ${offsetMs > 0 ? 'ahead of' : 'behind'} the gateway's: its events and the gateway's no longer line up (TwinCAT's time, or Windows': set both by the same time server)`;
        log(`load: ${text}`);
        onEvent?.({ event: 'clock', level: 'warn', rule: 'PLC clocks', ruleId: 'clock', plc: id, plcName: plc?.name ?? id, machine: '(its clock)', state: 'offset', text, at: new Date().toISOString() });
      }
    } catch {
      s.handles.delete(p);
    }
  };

  const tick = async () => {
    sampleProcess();
    for (const [id, conn] of connections()) {
      if (!conn.client) {
        const old = perPlc.get(id);
        if (old) old.client = null;
        continue;
      }
      const s = watchTasks(id, conn);
      const st = conn.sharedVars?.()?.stats();
      if (st) {
        const now = Date.now();
        if (s.prevSamples !== null) s.samplesPerSec = ((st.samples - s.prevSamples) * 1000) / Math.max(1, now - s.prevAt);
        s.prevSamples = st.samples;
        s.prevAt = now;
      }
      await sampleTasks(id, s).catch(() => {});
    }
  };
  const timer = setInterval(() => void tick().catch((err) => log(`load: ${err.message}`)), EVERY_MS);
  timer.unref();

  return {
    /** The panel's numbers now */
    snapshot() {
      const plcs = [];
      for (const [id, conn] of connections()) {
        const plc = plcOf(id);
        const s = perPlc.get(id);
        const st = conn.client ? conn.sharedVars?.()?.stats() : null;
        plcs.push({
          id, name: plc?.name ?? id, connected: !!conn.client, plcState: conn.plcState ?? null,
          shared: st ? { notifications: st.notifications, uses: st.uses, watchers: st.watchers, cycleMs: st.cycleMs, samplesPerSec: Math.round((s?.samplesPerSec ?? 0) * 10) / 10 } : null,
          live: { notifications: conn.symbols?.size ?? 0 },
          clock: s?.clock?.offsetMs !== null && s?.clock?.offsetMs !== undefined ? { offsetMs: s.clock.offsetMs, driftMsPerDay: driftOf(s.clock.samples) === null ? null : Math.round(driftOf(s.clock.samples)) } : null,
          tasks: s ? [...s.tasks.values()].filter((t) => t.name).sort((a, b) => a.index - b.index).map((t) => ({ name: t.name, cycleUs: t.cycleUs, execUs: t.execUs, maxExecUs: t.maxExecUs, overruns: t.overruns, overrunsLastHour: t.overrunTimes.length, exceeded: t.exceeded, rtViolations: t.rtViolations })) : [],
        });
      }
      for (const plc of plcList()) if (!plcs.some((x) => x.id === plc.id)) plcs.push({ id: plc.id, name: plc.name, connected: false, shared: null, live: { notifications: 0 }, tasks: [] });
      return {
        at: Date.now(), since: started, host: os.hostname(), cores: os.cpus().length,
        machine: { cpuPct: Math.round(proc.machinePct * 10) / 10, freeMemMB: Math.round(os.freemem() / 1048576), totalMemMB: Math.round(os.totalmem() / 1048576) },
        gateway: { cpuPct: Math.round(proc.cpuPct * 10) / 10, rssMB: Math.round(proc.rssMB), heapMB: Math.round(proc.heapMB), loopP99Ms: Math.round(proc.loopP99Ms * 10) / 10, loopMaxMs: Math.round(proc.loopMaxMs * 10) / 10, uptimeS: Math.round(process.uptime()) },
        plcs,
      };
    },
    stop() {
      clearInterval(timer);
      loop.disable();
      for (const s of perPlc.values()) s.watcher?.close().catch(() => {});
    },
  };
}

module.exports = { createLoad, driftOf };
