// Desktop live view: a session (shared/liveSession.cjs) per window, whose instance paths and ADS port come from the
// PLC project's files next to the opened .TcPOU (tcLiveTargets.cjs), else from the PLC's own tables.
const { createLiveSession } = require('../shared/liveSession.cjs');
const { plcPort, instancePaths } = require('./tcLiveTargets.cjs');

/** A new live session (each window follows its own POU) */
module.exports = () => createLiveSession({ findInstances: instancePaths, plcPort });
