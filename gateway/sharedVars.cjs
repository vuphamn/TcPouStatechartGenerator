// One ADS notification per PLC variable, shared by everything the gateway follows on that PLC: the boards, each alert
// rule, each recording, the I/O page's signals, the load panel's tasks. Before, each one had its own handle and
// notification: a machine on the board, alarmed and recorded cost three. Each user gets a watcher with VarWatcher's
// interface (shared/liveVars.cjs: set, drain, close, size); a variable is subscribed when the first one wants it
// (its value read at once, then on change, checked every 10 ms) and released when the last one lets it go. Counted
// for the setup page's load panel. The live sessions (a diagram live, 1 ms) keep their own (gateway.cjs PlcConnection).

class SharedVars {
  /** client: the PLC connection's ads-client (a new connection: a new SharedVars) */
  constructor(client, ads, { cycleMs = 10 } = {}) {
    this.client = client;
    this.ads = ads;
    this.cycleMs = cycleMs;
    this.entries = new Map(); // symbol (lower case) -> { symbol, info, handle, subscription, users: Set, last, ready }
    this.resolved = new Map(); // candidate (lower case) -> Promise<info | null>
    this.samples = 0;
    this.watchers = new Set();
    this.types = new Map(); // the PLC's data types read (a member searched by its words)
  }

  watcher(send = () => {}) {
    const w = new SharedWatcher(this, send);
    this.watchers.add(w);
    return w;
  }

  /** The first of the candidates the PLC has: { symbol, info } (each name looked up once per connection) */
  async resolve(candidates) {
    for (const c of candidates) {
      const k = c.toLowerCase();
      if (!this.resolved.has(k)) this.resolved.set(k, this.ads.probe(this.client, c).catch(() => null));
      const info = await this.resolved.get(k);
      if (info) return { symbol: c, info };
    }
    return null;
  }

  /** The variable followed for user (subscribed when it is the first): its entry, with its last value */
  async acquire(symbol, info, user) {
    const key = symbol.toLowerCase();
    let e = this.entries.get(key);
    if (!e) {
      e = { symbol, info, handle: 0, subscription: null, users: new Set(), last: null, ready: null };
      this.entries.set(key, e);
      const entry = e;
      e.ready = (async () => {
        entry.handle = await this.ads.createHandle(this.client, symbol);
        entry.last = { t: Date.now(), v: await this.ads.readTyped(this.client, entry.handle, info) };
        entry.subscription = await this.ads.subscribeTyped(
          this.client,
          entry.handle,
          info,
          (s) => {
            if (this.entries.get(key) !== entry) return;
            entry.last = s;
            this.samples++;
            for (const u of entry.users) u.push(key, s);
          },
          this.cycleMs
        );
      })();
    }
    e.users.add(user);
    try {
      await e.ready;
    } catch (err) {
      e.users.delete(user);
      if (!e.users.size && this.entries.get(key) === e) this.entries.delete(key);
      throw err;
    }
    return e;
  }

  /** user lets the variable go; the last one: unsubscribed, its handle released */
  async release(key, user) {
    const e = this.entries.get(key);
    if (!e) return;
    e.users.delete(user);
    if (e.users.size) return;
    this.entries.delete(key);
    await e.ready?.catch(() => {});
    try {
      if (e.subscription) await this.client.unsubscribe(e.subscription);
      if (e.handle) await this.ads.releaseHandle(this.client, e.handle);
    } catch {
      // (the connection gone: nothing left to release)
    }
  }

  /** For the load panel: notifications now, samples since the start, users */
  stats() {
    let users = 0;
    for (const e of this.entries.values()) users += e.users.size;
    return { notifications: this.entries.size, samples: this.samples, uses: users, watchers: this.watchers.size, cycleMs: this.cycleMs };
  }
}

/** One user's view (VarWatcher's interface): its ids mapped to the shared variables */
class SharedWatcher {
  constructor(shared, send) {
    this.shared = shared;
    this.send = send;
    this.ids = new Map(); // id -> key
    this.byKey = new Map(); // key -> Set of ids
    this.failed = new Set();
    this.queue = [];
    this.chain = Promise.resolve();
    this.closed = false;
  }

  push(key, s) {
    for (const id of this.byKey.get(key) ?? []) this.queue.push({ id, t: s.t, v: s.v });
  }

  /** Follows exactly these variables ({ id, candidates }); calls are applied in order */
  set(vars) {
    this.chain = this.chain.then(() => this.apply(vars)).catch(() => {});
    return this.chain;
  }

  async drop(id) {
    const key = this.ids.get(id);
    this.ids.delete(id);
    const set = this.byKey.get(key);
    if (!set) return;
    set.delete(id);
    if (!set.size) {
      this.byKey.delete(key);
      await this.shared.release(key, this);
    }
  }

  async apply(vars) {
    if (this.closed) return;
    const wanted = new Map(vars.map((v) => [v.id, v]));
    for (const id of [...this.ids.keys()]) if (!wanted.has(id)) await this.drop(id);
    for (const id of this.failed) if (!wanted.has(id)) this.failed.delete(id);
    const results = [];
    for (const v of vars) {
      if (this.closed) return;
      if (this.ids.has(v.id) || this.failed.has(v.id)) continue;
      let found = await this.shared.resolve(v.candidates ?? []);
      // (a method's VAR_INST: under the FB's instance by the words of its name, as VarWatcher does)
      if (!found && v.search) {
        const p = await this.shared.ads.findMember(this.shared.client, v.search.under, v.search.words, this.shared.types).catch(() => null);
        if (p) found = await this.shared.resolve([p]);
      }
      if (!found) {
        this.failed.add(v.id);
        results.push({ id: v.id, error: 'not in the PLC (a local of the method, a property or a method?)' });
        continue;
      }
      if (!this.shared.ads.isSimpleValue(found.info)) {
        this.failed.add(v.id);
        results.push({ id: v.id, symbol: found.symbol, type: found.info.type, error: `${found.info.type} is not a simple value` });
        continue;
      }
      const key = found.symbol.toLowerCase();
      try {
        const e = await this.shared.acquire(found.symbol, found.info, this);
        if (this.closed) {
          await this.shared.release(key, this);
          return;
        }
        this.ids.set(v.id, key);
        if (!this.byKey.has(key)) this.byKey.set(key, new Set());
        this.byKey.get(key).add(v.id);
        if (e.last) this.queue.push({ id: v.id, t: e.last.t || Date.now(), v: e.last.v });
        // (an enum: its names by value, as the PLC describes it: a sub-machine's states without its .TcDUT)
        const dt = await this.shared.ads.dataTypeInfo(this.shared.client, found.info.type, this.shared.types).catch(() => null);
        results.push({ id: v.id, symbol: found.symbol, type: found.info.type, ...(dt?.enumValues ? { enumNames: dt.enumValues } : {}) });
      } catch (err) {
        this.failed.add(v.id);
        results.push({ id: v.id, error: this.shared.ads.adsErrorText?.(err) ?? String(err?.message ?? err) });
      }
    }
    if (results.length && !this.closed) this.send({ type: 'liveWatchResult', vars: results });
  }

  drain() {
    return this.queue.length ? this.queue.splice(0) : null;
  }

  async close() {
    this.closed = true;
    await this.chain.catch(() => {});
    for (const key of [...this.byKey.keys()]) await this.shared.release(key, this);
    this.byKey.clear();
    this.ids.clear();
    this.shared.watchers.delete(this);
  }

  get size() {
    return this.ids.size;
  }
}

module.exports = { SharedVars };
