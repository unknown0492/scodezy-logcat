// src/adb.js - Runs adb against scodezy-logcat's OWN adb server (port 5038 by default), never the shared one (5037)
const { execFile, spawn } = require( 'child_process' );
const config = require( './config' );

/**
 * @description adb arguments with the private server port in front
 * @param {string[]} args
 * @returns {string[]}
 */
function withPort( args ){
    return [ '-P', String( config.adbServerPort ) ].concat( args );
}

/**
 * @description Runs one adb command and returns its output (never throws)
 * @param {string[]} args - adb arguments (without -P)
 * @param {number} [timeoutMs] - Killed after this long
 * @returns {Promise<{ code: number, out: string }>} code 0 = success
 */
function run( args, timeoutMs ){
    return new Promise( ( resolve ) => {
        execFile( config.adbPath, withPort( args ), { timeout: timeoutMs || 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, ( error, stdout, stderr ) => {
            const out = ( String( stdout || '' ) + String( stderr || '' ) ).trim();
            resolve( { code: error ? ( typeof error.code === 'number' ? error.code : 1 ) : 0, out: error && !out ? String( error.message ) : out } );
        });
    });
}

/**
 * @description Starts a long-running adb command (logcat)
 * @param {string[]} args - adb arguments (without -P)
 * @returns {ChildProcess}
 */
function start( args ){
    return spawn( config.adbPath, withPort( args ), { windowsHide: true } );
}

/**
 * @description Makes sure the private adb server runs (adb starts it when it is not running)
 * @returns {Promise<boolean>} true when it answers
 */
async function ensureServer(){
    const result = await run( [ 'start-server' ], 20000 );
    return result.code === 0;
}

/**
 * @description States of the devices known to the private server
 * @returns {Promise<Object|null>} serial -> state (device | offline | unauthorized ...), null when the server did not answer
 */
async function devices(){
    const result = await run( [ 'devices' ], 10000 );
    if( result.code !== 0 ){
        return null;
    }
    const states = {};   // serial -> state
    result.out.split( /\r?\n/ ).slice( 1 ).forEach( ( line ) => {
        const parts = line.trim().split( /\s+/ );
        if( parts.length >= 2 ){
            states[ parts[ 0 ] ] = parts[ 1 ];
        }
    });
    return states;
}

module.exports = { run, start, ensureServer, devices };
