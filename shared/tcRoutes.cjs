// Add Route from the Live tab's Browse (desktop app, Link): on the PLC, a route to this computer; and, when TwinCAT
// runs on this computer too (both), the route pair XAE's Add Route makes: on the PLC for this computer's TwinCAT
// router (its NetId), and in that router for the PLC (with this computer's Windows user: the same UDP Add Route
// request, sent to this computer's own TwinCAT). MachineScope then reaches the PLC through the router, as XAE does.
// The passwords are only passed on, never kept.
const os = require('os');
const { addRoute } = require('./tcDiscovery.cjs');
const { localIpTowards, defaultLocalNetId, localTwinCatNetId } = require('./liveSession.cjs');

const NETID = /^\d{1,3}(\.\d{1,3}){5}$/;
const HOST = /^[A-Za-z0-9.-]{1,253}$/;

/**
 * req: { plcIp, plcNetId?, plcName?, user, password, localNetId?, routeName?, both?, localUser?, localPassword? } →
 * { ok, message, both?: true, localTwinCat?: NetId }
 */
async function addRoutes(req, { port = Number(process.env.KSS_DISCOVERY_PORT) || 48899 } = {}) {
  const plcIp = String(req?.plcIp ?? '').trim().split(':')[0];
  if (!HOST.test(plcIp)) return { ok: false, message: 'The PLC\'s IP address is needed' };
  const hostAddress = localIpTowards(plcIp);
  const routeName = String(req?.routeName || os.hostname()).slice(0, 60);
  const router = localTwinCatNetId();
  const user = String(req?.user ?? '');
  const password = String(req?.password ?? '');
  if (!req?.both || !router) {
    const localNetId = NETID.test(req?.localNetId ?? '') ? req.localNetId : defaultLocalNetId(hostAddress);
    const r = await addRoute({ plcIp, localNetId, hostAddress, routeName, user, password, port });
    return { ...r, ...(router ? { localTwinCat: router } : {}) };
  }
  const plcNetId = String(req.plcNetId ?? '').trim();
  if (!NETID.test(plcNetId)) return { ok: false, message: 'The PLC\'s AMS NetId is needed (pick it in Browse)' };
  // 1. On the PLC: a route to this computer's TwinCAT router
  const onPlc = await addRoute({ plcIp, localNetId: router, hostAddress, routeName, user, password, port });
  if (!onPlc.ok) return { ...onPlc, both: true, localTwinCat: router };
  // 2. In this computer's router: a route to the PLC (this computer's Windows user)
  const here = await addRoute({ plcIp: '127.0.0.1', localNetId: plcNetId, hostAddress: plcIp, routeName: String(req.plcName || plcIp).replace(/[^\w .()-]/g, '').slice(0, 60) || plcIp, user: String(req.localUser ?? ''), password: String(req.localPassword ?? ''), port });
  if (!here.ok) return { ok: false, both: true, localTwinCat: router, message: `On the PLC: added (for this PC's TwinCAT, ${router}). On this PC: ${here.message}` };
  return { ok: true, both: true, localTwinCat: router, message: `Added both ways, as XAE does: on the PLC for this PC's TwinCAT (${router}, ${hostAddress}), and here for the PLC (${plcNetId}, ${plcIp}). XAE and MachineScope both reach it.` };
}

module.exports = { addRoutes };
