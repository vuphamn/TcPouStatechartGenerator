// Guard variables of a live session: the app asks for a set of variables (liveWatch: { id, candidates }[]); each is
// looked up in the PLC (the first candidate path it has), and followed with a change notification. Lookup results
// go back as liveWatchResult, values as liveVars. Used by the live session (desktop app, Link) and the gateway.
const ads = require('./tcAds.cjs');

/** Most variables one viewer follows (the gateway may set fewer) */
const MAX_VARS = 300;

/** Checks a liveWatch request: [{ id, candidates: [path, ...] }]; null when malformed */
function parseWatchRequest(vars, max = MAX_VARS) {
  if (!Array.isArray(vars) || vars.length > max) return null;
  const out = [];
  for (const v of vars) {
    if (!v || typeof v.id !== 'string' || v.id.length > 250 || !Array.isArray(v.candidates) || v.candidates.length === 0 || v.candidates.length > 4) return null;
    if (!v.candidates.every(ads.isSymbolPath)) return null;
    out.push({ id: v.id, candidates: v.candidates });
  }
  return out;
}

class VarWatcher {
  /** client: a connected ads-client (raw mode); send: posts liveWatchResult messages */
  constructor(client, send) {
    this.client = client;
    this.send = send;
    this.entries = new Map(); // id -> { symbol, handle, info, subscription }
    this.failed = new Set(); // ids not found / not readable: not looked up again while wanted
    this.queue = [];
    this.chain = Promise.resolve();
    this.closed = false;
  }

  /** Follows exactly these variables (the others are released); calls are applied in order */
  set(vars) {
    this.chain = this.chain.then(() => this.apply(vars)).catch(() => {});
    return this.chain;
  }

  async apply(vars) {
    if (this.closed) return;
    const wanted = new Map(vars.map((v) => [v.id, v]));
    for (const [id, entry] of this.entries) {
      if (wanted.has(id)) continue;
      this.entries.delete(id);
      await this.release(entry);
    }
    for (const id of this.failed) if (!wanted.has(id)) this.failed.delete(id);
    const results = [];
    for (const v of vars) {
      if (this.closed) return;
      if (this.entries.has(v.id) || this.failed.has(v.id)) continue;
      const result = { id: v.id };
      try {
        let found = null;
        for (const c of v.candidates) {
          const info = await ads.probe(this.client, c);
          if (info) {
            found = { symbol: c, info };
            break;
          }
        }
        if (!found) {
          result.error = 'not in the PLC (a local of the method, a property or a method?)';
        } else if (!ads.isSimpleValue(found.info)) {
          result.symbol = found.symbol;
          result.type = found.info.type;
          result.error = `${found.info.type} is not a simple value`;
        } else {
          const entry = { symbol: found.symbol, info: found.info, handle: 0, subscription: null };
          entry.handle = await ads.createHandle(this.client, found.symbol);
          this.entries.set(v.id, entry);
          this.queue.push({ id: v.id, t: Date.now(), v: await ads.readTyped(this.client, entry.handle, found.info) });
          entry.subscription = await ads.subscribeTyped(this.client, entry.handle, found.info, (s) => {
            if (this.entries.get(v.id) === entry) this.queue.push({ id: v.id, t: s.t, v: s.v });
          });
          result.symbol = found.symbol;
          result.type = found.info.type;
        }
      } catch (err) {
        result.error = ads.adsErrorText(err);
      }
      if (result.error) this.failed.add(v.id);
      results.push(result);
    }
    if (results.length && !this.closed) this.send({ type: 'liveWatchResult', vars: results });
  }

  /** Values since the last call */
  drain() {
    return this.queue.length ? this.queue.splice(0) : null;
  }

  async release(entry) {
    try {
      if (entry.subscription) await this.client.unsubscribe(entry.subscription);
      if (entry.handle) await ads.releaseHandle(this.client, entry.handle);
    } catch {
      // the connection may be gone
    }
  }

  /** Releases every variable (the connection stays open) */
  async close() {
    this.closed = true;
    await this.chain.catch(() => {});
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const e of entries) await this.release(e);
  }

  get size() {
    return this.entries.size;
  }
}

module.exports = { VarWatcher, parseWatchRequest, MAX_VARS };
