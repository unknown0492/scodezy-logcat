// ecosystem.config.js - pm2 process of scodezy-logcat: pm2 start ecosystem.config.js
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
            LOGCAT_ADB_PORT: '5038'
        }
    } ]
};
