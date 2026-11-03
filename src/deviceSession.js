// src/deviceSession.js - One TV: keeps it connected on the private adb server, streams its logcat, remembers the lines,
// and follows the process IDs of the packages the pages are watching.
const EventEmitter = require( 'events' );
const readline = require( 'readline' );
const adb = require( './adb' );
const config = require( './config' );

// logcat -v threadtime: "MM-DD HH:MM:SS.mmm  PID  TID L TAG: message"
const THREADTIME = /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEFAS])\s/;
// ActivityManager line naming a new process: "Start proc 1234:com.example.app/u0a12 ..."
const START_PROC = /Start proc (\d+):([a-zA-Z0-9_.]+)/;
// Order of log levels (filter = this level and higher)
const LEVELS = [ 'V', 'D', 'I', 'W', 'E', 'F', 'A' ];

class DeviceSession extends EventEmitter {

    /**
     * @param {string} ip - As typed (port optional)
     */
    constructor( ip ){
        super();
        this.ip = ip;                                          // As typed
        this.serial = ip.includes( ':' ) ? ip : ip + ':5555';  // adb serial
        this.status = 'connecting';                            // connecting | connected | reconnecting | unauthorized | error | stopped
        this.detail = '';                                      // Last problem, for the page
        this.lines = [];                                       // { i, t, p, l } kept for Save (capped)
        this.seq = 0;                                          // Number of the last line
        this.logcat = null;                                    // Running logcat process
        this.lastTime = '';                                    // Time stamp of the last line (resume point)
        this.lastTimeLines = new Set();                        // Lines with that time stamp (no duplicates after a resume)
        this.resumeFrom = '';                                  // Set while logcat replays from the resume point
        this.resumeLines = null;                               // Lines already kept for that time stamp
        this.watchers = new Map();                             // package -> number of pages watching it
        this.pids = new Map();                                 // package -> Set of PIDs seen this session
        this.subscribers = 0;                                  // Pages that have this TV open
        this.idleSince = Date.now();                           // When the last page left
        this.stopped = false;
        this.busy = false;                                     // A watchdog round is running
        this.timer = setInterval( () => this.watchdog(), config.watchdogMs );
        this.pidTimer = setInterval( () => this.pollPids(), config.pidPollMs );
        this.watchdog();
    }

    /**
     * @description Status for the pages
     * @returns {Object}
     */
    state(){
        return { ip: this.ip, serial: this.serial, status: this.status, detail: this.detail, lines: this.lines.length, last: this.seq };
    }

    /**
     * @description Changes the status and tells the pages
     * @param {string} status
     * @param {string} [detail]
     * @returns {void}
     */
    setStatus( status, detail ){
        if( status === this.status && ( detail || '' ) === this.detail ){
            return;
        }
        this.status = status;
        this.detail = detail || '';
        this.emit( 'state', this.state() );
    }

    /**
     * @description Runs every 2 s: private adb server up, TV connected, logcat running - whatever is missing is redone
     * @returns {Promise<void>}
     */
    async watchdog(){
        if( this.stopped || this.busy ){
            return;
        }
        this.busy = true;
        try{
            let states = await adb.devices();
            if( states === null ){
                // Private server gone (killed by something) - start it again
                await adb.ensureServer();
                states = await adb.devices();
                if( states === null ){
                    this.setStatus( 'error', 'The adb server could not be started (is adb on the PATH?)' );
                    return;
                }
            }
            const state = states[ this.serial ];
            if( state === 'device' ){
                if( !this.logcat ){
                    this.startLogcat();
                }
                this.setStatus( 'connected' );
                return;
            }
            if( state === 'unauthorized' ){
                this.setStatus( 'unauthorized', 'Allow USB debugging on the TV (tick "Always allow from this computer")' );
                return;
            }
            // Missing or offline: connect again
            this.setStatus( this.status === 'connected' ? 'reconnecting' : ( this.status === 'reconnecting' ? 'reconnecting' : 'connecting' ), this.detail );
            if( state === 'offline' ){
                await adb.run( [ 'disconnect', this.serial ], 8000 );
            }
            const result = await adb.run( [ 'connect', this.serial ], 12000 );
            if( !/connected to|already connected/i.test( result.out ) ){
                this.setStatus( this.status === 'connecting' ? 'connecting' : 'reconnecting', result.out || 'No answer from the TV' );
            }
        } catch( error ){
            this.setStatus( 'error', error.message );
        } finally {
            this.busy = false;
        }
    }

    /**
     * @description Starts logcat; after a drop it resumes at the last time stamp, so no line is lost or repeated
     * @returns {void}
     */
    startLogcat(){
        const args = [ '-s', this.serial, 'logcat', '-v', 'threadtime' ];
        if( this.lastTime ){
            // Resume at the last time stamp; the lines already kept for it are skipped when logcat repeats them
            args.push( '-T', this.lastTime );
            this.resumeFrom = this.lastTime;
            this.resumeLines = new Set( this.lastTimeLines );
        }
        const proc = adb.start( args );
        this.logcat = proc;
        const reader = readline.createInterface( { input: proc.stdout } );
        let batch = [];                                         // Lines waiting to be sent to the pages
        const flush = () => {
            if( batch.length > 0 ){
                this.emit( 'lines', batch );
                batch = [];
            }
        };
        const flushTimer = setInterval( flush, 200 );
        reader.on( 'line', ( raw ) => {
            const line = this.addLine( raw.replace( /\r+$/, '' ) );
            if( line ){
                batch.push( line );
                if( batch.length >= 500 ){
                    flush();
                }
            }
        });
        proc.on( 'error', () => {} );
        proc.on( 'close', () => {
            clearInterval( flushTimer );
            flush();
            if( this.logcat === proc ){
                this.logcat = null;   // The watchdog starts it again (reconnecting first when needed)
            }
        });
    }

    /**
     * @description Stores one logcat line (skips repeats after a resume) and learns PIDs from "Start proc" lines
     * @param {string} raw
     * @returns {Object|null} { i, t, p, l } or null when skipped
     */
    addLine( raw ){
        if( raw === '' ){
            return null;
        }
        const match = raw.match( THREADTIME );
        if( match ){
            const time = match[ 1 ];
            // Just after a resume, logcat repeats lines from the resume time stamp on: skip what we already have
            if( this.resumeFrom ){
                if( time < this.resumeFrom || ( time === this.resumeFrom && this.resumeLines.has( raw ) ) ){
                    return null;
                }
                if( time > this.resumeFrom ){
                    this.resumeFrom = '';
                    this.resumeLines = null;
                }
            }
            if( time !== this.lastTime ){
                this.lastTime = time;
                this.lastTimeLines = new Set();
            }
            this.lastTimeLines.add( raw );
            const started = raw.match( START_PROC );
            if( started && this.pids.has( started[ 2 ] ) ){
                this.notePid( started[ 2 ], started[ 1 ] );
            }
        }
        const line = { i: ++this.seq, t: raw, p: match ? match[ 2 ] : '', l: match ? match[ 4 ] : '' };
        this.lines.push( line );
        if( this.lines.length > config.maxServerLines ){
            this.lines.splice( 0, this.lines.length - config.maxServerLines );
        }
        return line;
    }

    /**
     * @description Starts following the PIDs of a package (a page selected it)
     * @param {string} pkg
     * @returns {void}
     */
    watchPackage( pkg ){
        this.watchers.set( pkg, ( this.watchers.get( pkg ) || 0 ) + 1 );
        if( !this.pids.has( pkg ) ){
            this.pids.set( pkg, new Set() );
        }
        this.readPids( pkg );
    }

    /**
     * @description Stops following a package when no page watches it any more
     * @param {string} pkg
     * @returns {void}
     */
    unwatchPackage( pkg ){
        const count = ( this.watchers.get( pkg ) || 0 ) - 1;
        if( count > 0 ){
            this.watchers.set( pkg, count );
        } else {
            this.watchers.delete( pkg );
        }
    }

    /**
     * @description Adds a PID of a package and tells the pages
     * @param {string} pkg
     * @param {string} pid
     * @returns {void}
     */
    notePid( pkg, pid ){
        const set = this.pids.get( pkg ) || new Set();
        if( set.has( pid ) ){
            return;
        }
        set.add( pid );
        this.pids.set( pkg, set );
        this.emit( 'pids', { ip: this.ip, pkg: pkg, pids: Array.from( set ) } );
    }

    /**
     * @description PIDs of one package
     * @param {string} pkg
     * @returns {string[]}
     */
    pidsOf( pkg ){
        return Array.from( this.pids.get( pkg ) || [] );
    }

    /**
     * @description Reads the running PIDs of a package on the TV (pidof)
     * @param {string} pkg
     * @returns {Promise<void>}
     */
    async readPids( pkg ){
        if( this.status !== 'connected' ){
            return;
        }
        const result = await adb.run( [ '-s', this.serial, 'shell', 'pidof', pkg ], 8000 );
        if( result.code === 0 ){
            result.out.split( /\s+/ ).filter( ( v ) => /^\d+$/.test( v ) ).forEach( ( pid ) => this.notePid( pkg, pid ) );
        }
        // An app with a :service process has its own name
        const extra = await adb.run( [ '-s', this.serial, 'shell', 'ps -A -o PID,NAME' ], 8000 );
        if( extra.code === 0 ){
            extra.out.split( /\r?\n/ ).forEach( ( row ) => {
                const parts = row.trim().split( /\s+/ );
                if( parts.length === 2 && /^\d+$/.test( parts[ 0 ] ) && parts[ 1 ].startsWith( pkg + ':' ) ){
                    this.notePid( pkg, parts[ 0 ] );
                }
            });
        }
    }

    /**
     * @description Every 3 s: PIDs of the watched packages (an app that restarted gets a new PID)
     * @returns {void}
     */
    pollPids(){
        if( this.stopped ){
            return;
        }
        Array.from( this.watchers.keys() ).forEach( ( pkg ) => this.readPids( pkg ).catch( () => {} ) );
    }

    /**
     * @description Lines for Save: everything, or filtered like the page
     * @param {Object} filter - { pkg, only, level, q }
     * @returns {string[]}
     */
    exportLines( filter ){
        const minLevel = LEVELS.indexOf( filter.level );                       // -1 = all levels
        const pids = filter.only && filter.pkg ? new Set( this.pidsOf( filter.pkg ) ) : null;
        const q = String( filter.q || '' ).toLowerCase();
        return this.lines.filter( ( line ) => {
            if( pids && !pids.has( line.p ) ){
                return false;
            }
            if( minLevel > 0 && LEVELS.indexOf( line.l ) < minLevel ){
                return false;
            }
            if( q && line.t.toLowerCase().indexOf( q ) < 0 ){
                return false;
            }
            return true;
        }).map( ( line ) => line.t );
    }

    /**
     * @description Lets the TV go: logcat stopped, disconnected from the private server (the shared one is not touched)
     * @returns {Promise<void>}
     */
    async stop(){
        this.stopped = true;
        clearInterval( this.timer );
        clearInterval( this.pidTimer );
        if( this.logcat ){
            this.logcat.kill();
            this.logcat = null;
        }
        await adb.run( [ 'disconnect', this.serial ], 8000 );
        this.setStatus( 'stopped' );
    }
}

module.exports = { DeviceSession, LEVELS };
