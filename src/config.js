// src/config.js - Settings of scodezy-logcat (environment variables override the defaults)
const path = require( 'path' );

module.exports = {
    // Web page and WebSocket; 127.0.0.1 = only this PC can open it
    host: process.env.LOGCAT_HOST || '127.0.0.1',
    port: parseInt( process.env.LOGCAT_PORT, 10 ) || 3737,

    // Private adb server: other tools on this PC use the shared one on 5037, so their
    // "adb disconnect" / "adb kill-server" never reach the devices connected here
    adbPath: process.env.ADB_PATH || 'adb',
    adbServerPort: parseInt( process.env.LOGCAT_ADB_PORT, 10 ) || 5038,

    // A device is checked (and reconnected when needed) this often
    watchdogMs: 2000,
    // The PIDs of a watched package are read this often
    pidPollMs: 3000,
    // A device nobody has open any more is let go after this long
    idleStopMs: 10 * 60 * 1000,

    // Lines kept per device on the server (used by Save); oldest dropped first
    maxServerLines: 200000,
    // Lines sent to a page when it opens a device
    backlogLines: 5000,

    // Remembered IPs and packages
    historyFile: path.join( process.env.LOGCAT_DATA_DIR || path.join( __dirname, '..', 'data' ), 'history.json' ),
    // History lists are kept this short
    maxHistory: 50
};
