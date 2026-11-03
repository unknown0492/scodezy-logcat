// src/history.js - IP addresses and package names entered before (data/history.json), newest first
const fs = require( 'fs' );
const path = require( 'path' );
const config = require( './config' );

// Device address: IPv4 with an optional :port
const IP_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(:\d{1,5})?$/;
// Android package name
const PACKAGE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;

class History {

    constructor(){
        this.data = { ips: [], packages: [] };   // Remembered lists
        this.load();
    }

    /**
     * @description Reads data/history.json (missing or broken file = empty lists)
     * @returns {void}
     */
    load(){
        try{
            const saved = JSON.parse( fs.readFileSync( config.historyFile, 'utf8' ) );
            this.data.ips = Array.isArray( saved.ips ) ? saved.ips.filter( ( v ) => IP_PATTERN.test( v ) ) : [];
            this.data.packages = Array.isArray( saved.packages ) ? saved.packages.filter( ( v ) => PACKAGE_PATTERN.test( v ) ) : [];
        } catch( e ){
            this.data = { ips: [], packages: [] };
        }
    }

    /**
     * @description Writes the lists (temporary file + rename, so a crash never leaves half a file)
     * @returns {void}
     */
    save(){
        fs.mkdirSync( path.dirname( config.historyFile ), { recursive: true } );
        const temp = config.historyFile + '.tmp';
        fs.writeFileSync( temp, JSON.stringify( this.data, null, 2 ) );
        fs.renameSync( temp, config.historyFile );
    }

    /**
     * @description Both lists
     * @returns {Object} { ips, packages }
     */
    get(){
        return { ips: this.data.ips.slice(), packages: this.data.packages.slice() };
    }

    /**
     * @description Adds (or moves to the top) an entry
     * @param {string} kind - 'ips' or 'packages'
     * @param {string} value - IP or package name
     * @returns {string} The stored value
     */
    add( kind, value ){
        const clean = this.validate( kind, value );
        this.data[ kind ] = [ clean ].concat( this.data[ kind ].filter( ( v ) => v !== clean ) ).slice( 0, config.maxHistory );
        this.save();
        return clean;
    }

    /**
     * @description Removes an entry
     * @param {string} kind - 'ips' or 'packages'
     * @param {string} value - IP or package name
     * @returns {void}
     */
    remove( kind, value ){
        this.data[ kind ] = this.data[ kind ].filter( ( v ) => v !== String( value || '' ).trim() );
        this.save();
    }

    /**
     * @description Checks a value; throws with a message for the page when it is not usable
     * @param {string} kind - 'ips' or 'packages'
     * @param {string} value
     * @returns {string} Trimmed value
     */
    validate( kind, value ){
        const clean = String( value || '' ).trim();
        if( kind === 'ips' && !IP_PATTERN.test( clean ) ){
            throw new Error( 'Type an IP address like 192.168.1.25 (optionally with :port)' );
        }
        if( kind === 'packages' && !PACKAGE_PATTERN.test( clean ) ){
            throw new Error( 'Type a package name like com.excel.estvlauncher.gen3' );
        }
        if( kind !== 'ips' && kind !== 'packages' ){
            throw new Error( 'Unknown list' );
        }
        return clean;
    }
}

module.exports = { History, IP_PATTERN, PACKAGE_PATTERN };
