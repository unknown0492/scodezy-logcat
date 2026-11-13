// ecosystem.config.js - pm2 process of scodezy-logcat: pm2 start ecosystem.config.js
// adb: platform-tools\adb.exe in this folder when install.ps1 downloaded it, else ADB_PATH / adb on the PATH (1.0.3)
const fs = require( 'fs' );
const path = require( 'path' );
const localAdb = path.join( __dirname, 'platform-tools', 'adb.exe' );

module.exports = {
    apps: [ {
        name: 'scodezy-logcat',
        script: 'server.js',
        cwd: __dirname,
        autorestart: true,
        max_memory_restart: '600M',
        env: {
            LOGCAT_HOST: '127.0.0.1',
            LOGCAT_PORT: '3737',
            LOGCAT_ADB_PORT: '5038',
            ADB_PATH: fs.existsSync( localAdb ) ? localAdb : ( process.env.ADB_PATH || 'adb' )
        }
    } ]
};
