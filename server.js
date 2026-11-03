// server.js - scodezy-logcat: live adb logcat of TVs in the browser, http://127.0.0.1:3737 (pm2 process "scodezy-logcat")
const http = require( 'http' );
const path = require( 'path' );
const express = require( 'express' );
const { WebSocketServer } = require( 'ws' );
const config = require( './src/config' );
const adb = require( './src/adb' );
const { History, IP_PATTERN, PACKAGE_PATTERN } = require( './src/history' );
const { DeviceSession, LEVELS } = require( './src/deviceSession' );
const version = require( './package.json' ).version;

const history = new History();          // Remembered IPs and packages
const sessions = new Map();             // ip -> DeviceSession
const clients = new Set();              // Open WebSockets

/**
 * @description Sends a message to one page
 * @param {WebSocket} ws
 * @param {Object} message
 * @returns {void}
 */
function send( ws, message ){
    if( ws.readyState === 1 ){
        ws.send( JSON.stringify( message ) );
    }
}

/**
 * @description Sends a message to every page that has this TV open
 * @param {string} ip
 * @param {Object} message
 * @returns {void}
 */
function sendToDevice( ip, message ){
    clients.forEach( ( ws ) => {
        if( ws.device === ip ){
            send( ws, message );
        }
    });
}

/**
 * @description The session of a TV, started when needed
 * @param {string} ip
 * @returns {DeviceSession}
 */
function sessionFor( ip ){
    let session = sessions.get( ip );
    if( !session ){
        session = new DeviceSession( ip );
        session.on( 'state', ( state ) => sendToDevice( ip, { type: 'state', state: state } ) );
        session.on( 'lines', ( lines ) => sendToDevice( ip, { type: 'lines', ip: ip, lines: lines } ) );
        session.on( 'pids', ( info ) => sendToDevice( ip, { type: 'pids', ip: info.ip, pkg: info.pkg, pids: info.pids } ) );
        sessions.set( ip, session );
    }
    return session;
}

/**
 * @description A page leaves a TV (and the package it watched there)
 * @param {WebSocket} ws
 * @returns {void}
 */
function leaveDevice( ws ){
    const session = ws.device ? sessions.get( ws.device ) : null;
    if( session ){
        if( ws.pkg ){
            session.unwatchPackage( ws.pkg );
        }
        session.subscribers = Math.max( 0, session.subscribers - 1 );
        if( session.subscribers === 0 ){
            session.idleSince = Date.now();
        }
    }
    ws.device = null;
    ws.pkg = null;
}

// TVs nobody has open for 10 minutes are let go
setInterval( () => {
    sessions.forEach( ( session, ip ) => {
        if( session.subscribers === 0 && Date.now() - session.idleSince > config.idleStopMs ){
            sessions.delete( ip );
            session.stop().catch( () => {} );
        }
    });
}, 60000 );

const app = express();
app.use( express.json() );
app.use( express.static( path.join( __dirname, 'public' ) ) );

// Remembered IPs and packages
app.get( '/api/history', ( req, res ) => res.json( { success: true, history: history.get(), version: version, levels: LEVELS } ) );

app.post( '/api/history/:kind', ( req, res ) => {
    try{
        const value = history.add( req.params.kind, req.body && req.body.value );
        res.json( { success: true, value: value, history: history.get() } );
    } catch( error ){
        res.status( 400 ).json( { success: false, message: error.message } );
    }
});

app.delete( '/api/history/:kind', ( req, res ) => {
    try{
        history.validate( req.params.kind, req.query.value );
        history.remove( req.params.kind, req.query.value );
        res.json( { success: true, history: history.get() } );
    } catch( error ){
        res.status( 400 ).json( { success: false, message: error.message } );
    }
});

// Save: all lines of the TV since it was opened, or only what the filters show
app.get( '/api/save', ( req, res ) => {
    const ip = String( req.query.ip || '' );
    const session = sessions.get( ip );
    if( !IP_PATTERN.test( ip ) || !session ){
        res.status( 404 ).type( 'text/plain' ).send( 'That TV is not open in scodezy-logcat' );
        return;
    }
    const filtered = req.query.mode === 'filtered';                       // false = everything
    const pkg = PACKAGE_PATTERN.test( String( req.query.pkg || '' ) ) ? String( req.query.pkg ) : '';
    const lines = filtered
        ? session.exportLines( { pkg: pkg, only: req.query.only === '1', level: String( req.query.level || '' ), q: String( req.query.q || '' ) } )
        : session.lines.map( ( line ) => line.t );
    const now = new Date();                                                // Local time of this PC
    const pad = ( v ) => String( v ).padStart( 2, '0' );
    const stamp = `${now.getFullYear()}${pad( now.getMonth() + 1 )}${pad( now.getDate() )}_${pad( now.getHours() )}${pad( now.getMinutes() )}${pad( now.getSeconds() )}`;
    const name = `${ip.replace( /[:.]/g, '-' )}_${stamp}${filtered ? '_filtered' : ''}.txt`;
    res.setHeader( 'Content-Disposition', `attachment; filename="${name}"` );
    res.type( 'text/plain; charset=utf-8' ).send( lines.join( '\r\n' ) + '\r\n' );
});

const server = http.createServer( app );
const wss = new WebSocketServer( { server: server, path: '/ws' } );

wss.on( 'connection', ( ws ) => {
    ws.device = null;   // TV this page has open
    ws.pkg = null;      // Package this page watches on it
    clients.add( ws );

    ws.on( 'message', ( data ) => {
        let message = null;
        try{
            message = JSON.parse( String( data ) );
        } catch( e ){
            return;
        }
        // Open a TV: connect, stream, and send the latest lines kept so far
        if( message.type === 'select' ){
            leaveDevice( ws );
            const ip = String( message.ip || '' ).trim();
            if( !ip ){
                return;
            }
            if( !IP_PATTERN.test( ip ) ){
                send( ws, { type: 'error', message: 'Not a valid IP address' } );
                return;
            }
            const session = sessionFor( ip );
            session.subscribers++;
            ws.device = ip;
            send( ws, { type: 'state', state: session.state() } );
            send( ws, { type: 'backlog', ip: ip, lines: session.lines.slice( -config.backlogLines ) } );
            return;
        }
        // Watch a package on the open TV (its PIDs are followed)
        if( message.type === 'package' ){
            const session = ws.device ? sessions.get( ws.device ) : null;
            if( !session ){
                return;
            }
            if( ws.pkg ){
                session.unwatchPackage( ws.pkg );
            }
            ws.pkg = PACKAGE_PATTERN.test( String( message.pkg || '' ) ) ? String( message.pkg ) : null;
            if( ws.pkg ){
                session.watchPackage( ws.pkg );
                send( ws, { type: 'pids', ip: ws.device, pkg: ws.pkg, pids: session.pidsOf( ws.pkg ) } );
            }
        }
    });

    ws.on( 'close', () => {
        leaveDevice( ws );
        clients.delete( ws );
    });
});

adb.ensureServer().then( ( ok ) => {
    console.log( ok ? `adb server on port ${config.adbServerPort} ready` : `adb server on port ${config.adbServerPort} could not be started - is adb on the PATH?` );
});

server.listen( config.port, config.host, () => {
    console.log( `scodezy-logcat ${version} on http://${config.host}:${config.port}` );
});

// pm2 stop / restart: let the TVs go cleanly
const shutdown = () => {
    Promise.all( Array.from( sessions.values() ).map( ( s ) => s.stop().catch( () => {} ) ) ).then( () => process.exit( 0 ) );
    setTimeout( () => process.exit( 0 ), 5000 );
};
process.on( 'SIGINT', shutdown );
process.on( 'SIGTERM', shutdown );
