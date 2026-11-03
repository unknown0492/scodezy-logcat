// public/app.js - scodezy-logcat page logic (jQuery). 1.0.1: one-toolbar layout, light / dark theme, column lines.

const LC = {

    MAX_CLIENT_LINES: 20000,      // Lines kept in the page (filters re-run over these)
    MAX_DOM_LINES: 3000,          // Lines shown at once
    LEVELS: [ 'V', 'D', 'I', 'W', 'E', 'F', 'A' ],   // Order of log levels
    ADD: '__add__',               // Dropdown option: add a new entry
    REMOVE: '__remove__',         // Dropdown option: remove the selected entry
    // logcat -v threadtime: date time pid tid level tag: message
    THREADTIME: /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEFAS])\s+(.*?)\s*: ?(.*)$/,
    STATUS_TEXT: {                // Status wording
        idle: 'No device', connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting',
        unauthorized: 'Allow USB debugging on the TV', error: 'Error', stopped: 'Stopped'
    },

    ws: null,                     // WebSocket to the server
    history: { ips: [], packages: [] },   // Remembered entries
    device: '',                   // Open TV (IP)
    pkg: '',                      // Selected package
    pids: new Set(),              // PIDs of the selected package
    lines: [],                    // { i, t, p, l } received for the open TV
    lastSeq: 0,                   // Number of the last line received (repeats are skipped)
    shown: 0,                     // Lines on screen
    query: '',                    // Applied search text
    autoScroll: true,             // Follow new lines

    /**
     * @description Starts the page: handlers, history, remembered choices, WebSocket
     * @returns {void}
     */
    init: function(){
        LC.bind();
        LC.loadHistory( function(){
            LC.restoreChoices();
            LC.connect();
        });
    },

    /**
     * @description Binds all handlers
     * @returns {void}
     */
    bind: function(){
        // Dropdowns: choose, "+ Add new...", or "Remove ... from the list"
        $( '#ip_select' ).on( 'change', function(){ LC.onSelectChange( 'ips', $( this ) ); } );
        $( '#pkg_select' ).on( 'change', function(){ LC.onSelectChange( 'packages', $( this ) ); } );

        // Inline add fields
        $( '[data-add]' ).on( 'click', function(){ LC.addHistory( $( this ).attr( 'data-add' ) ); } );
        $( '[data-cancel]' ).on( 'click', function(){ LC.closeAdder( $( this ).attr( 'data-cancel' ) ); } );
        $( '#ip_input, #pkg_input' ).on( 'keydown', function( e ){
            var kind = this.id === 'ip_input' ? 'ips' : 'packages';   // List of this field
            if( e.key === 'Enter' ){ LC.addHistory( kind ); }
            if( e.key === 'Escape' ){ LC.closeAdder( kind ); }
        });

        $( '#pkg_only' ).on( 'change', function(){ LC.remember(); LC.renderAll(); } );
        $( '#level_select' ).on( 'change', function(){ LC.remember(); LC.renderAll(); } );

        // Search
        $( '#search_btn' ).on( 'click', LC.applySearch );
        $( '#search_input' ).on( 'keydown', function( e ){
            if( e.key === 'Enter' ){ LC.applySearch(); }
            if( e.key === 'Escape' ){ $( this ).val( '' ); LC.applySearch(); }
        });
        $( '#search_clear' ).on( 'click', function(){ $( '#search_input' ).val( '' ); LC.applySearch(); } );

        $( '#clear_btn' ).on( 'click', function(){ LC.lines = []; LC.renderAll(); } );
        $( '#jump_btn' ).on( 'click', function(){ LC.autoScroll = true; LC.scrollToEnd(); } );
        $( '#log' ).on( 'scroll', function(){
            var el = this;   // Log area
            LC.autoScroll = ( el.scrollHeight - el.scrollTop - el.clientHeight ) < 40;
            $( '#jump_btn' ).toggleClass( 'hidden', LC.autoScroll );
        });

        // Save
        $( '#save_btn' ).on( 'click', function(){
            if( !LC.device ){
                LC.toast( 'Pick a device first' );
                return;
            }
            $( '#save_dialog' ).removeClass( 'hidden' );
        });
        $( '#save_filtered' ).on( 'click', function(){ LC.save( 'filtered' ); } );
        $( '#save_all' ).on( 'click', function(){ LC.save( 'all' ); } );
        $( '#save_cancel' ).on( 'click', function(){ $( '#save_dialog' ).addClass( 'hidden' ); } );
        $( '#save_dialog' ).on( 'click', function( e ){ if( e.target === this ){ $( this ).addClass( 'hidden' ); } } );

        // Theme
        $( '#theme_btn' ).on( 'click', LC.toggleTheme );
    },

    // ───────────── theme ─────────────

    /**
     * @description Switches light / dark and remembers it in this browser
     * @returns {void}
     */
    toggleTheme: function(){
        var next = $( 'html' ).attr( 'data-theme' ) === 'light' ? 'dark' : 'light';   // New theme
        $( 'html' ).attr( 'data-theme', next );
        try{ localStorage.setItem( 'scodezy-logcat-theme', next ); } catch( e ){}
    },

    // ───────────── history ─────────────

    /**
     * @description Reads the remembered IPs and packages
     * @param {Function} [done]
     * @returns {void}
     */
    loadHistory: function( done ){
        $.getJSON( '/api/history', function( res ){
            $( '#version' ).text( 'v' + res.version );
            LC.history = res.history;
            LC.fillAll();
            if( done ){ done(); }
        }).fail( function(){
            LC.toast( 'The scodezy-logcat server does not answer' );
        });
    },

    /**
     * @description Fills both dropdowns from the history
     * @returns {void}
     */
    fillAll: function(){
        LC.fillSelect( $( '#ip_select' ), LC.history.ips, 'Select a device', '+ Add new device...', LC.device );
        LC.fillSelect( $( '#pkg_select' ), LC.history.packages, 'No package', '+ Add new package...', LC.pkg );
    },

    /**
     * @description Fills one dropdown: placeholder, entries, "+ Add new...", and "Remove ..." for the selected entry
     * @param {jQuery} select
     * @param {string[]} values
     * @param {string} emptyText
     * @param {string} addText
     * @param {string} current - Selected entry
     * @returns {void}
     */
    fillSelect: function( select, values, emptyText, addText, current ){
        select.empty().append( $( '<option>' ).val( '' ).text( emptyText ) );
        $.each( values, function( i, value ){
            select.append( $( '<option>' ).val( value ).text( value ) );
        });
        select.append( $( '<option>' ).val( LC.ADD ).text( addText ) );
        var selected = current && values.indexOf( current ) >= 0 ? current : '';   // Entry kept selected
        if( selected ){
            select.append( $( '<option>' ).val( LC.REMOVE ).text( 'Remove ' + selected + ' from the list' ) );
        }
        select.val( selected );
    },

    /**
     * @description A dropdown changed: select an entry, open the add field, or remove the selected entry
     * @param {string} kind - 'ips' or 'packages'
     * @param {jQuery} select
     * @returns {void}
     */
    onSelectChange: function( kind, select ){
        var value = select.val();                                    // Chosen option
        var current = kind === 'ips' ? LC.device : LC.pkg;           // Entry selected before
        if( value === LC.ADD ){
            select.val( current );
            LC.openAdder( kind );
            return;
        }
        if( value === LC.REMOVE ){
            select.val( current );
            LC.removeHistory( kind, current );
            return;
        }
        if( kind === 'ips' ){ LC.selectDevice( value ); } else { LC.selectPackage( value ); }
        LC.fillAll();   // "Remove ..." follows the selection
    },

    /**
     * @description Turns a dropdown into a text field to add an entry
     * @param {string} kind - 'ips' or 'packages'
     * @returns {void}
     */
    openAdder: function( kind ){
        var field = $( kind === 'ips' ? '#ip_field' : '#pkg_field' );   // Field wrapper
        field.find( 'select' ).addClass( 'hidden' );
        field.find( '.adder' ).removeClass( 'hidden' ).find( 'input' ).val( '' ).trigger( 'focus' );
    },

    /**
     * @description Back from the text field to the dropdown
     * @param {string} kind - 'ips' or 'packages'
     * @returns {void}
     */
    closeAdder: function( kind ){
        var field = $( kind === 'ips' ? '#ip_field' : '#pkg_field' );   // Field wrapper
        field.find( '.adder' ).addClass( 'hidden' );
        field.find( 'select' ).removeClass( 'hidden' );
    },

    /**
     * @description Adds the typed IP or package to its list and selects it
     * @param {string} kind - 'ips' or 'packages'
     * @returns {void}
     */
    addHistory: function( kind ){
        var input = $( kind === 'ips' ? '#ip_input' : '#pkg_input' );   // Text field
        var value = $.trim( input.val() );
        if( value === '' ){
            LC.closeAdder( kind );
            return;
        }
        $.ajax({
            url: '/api/history/' + kind,
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify( { value: value } ),
            success: function( res ){
                LC.history = res.history;
                LC.closeAdder( kind );
                if( kind === 'ips' ){ LC.selectDevice( res.value ); } else { LC.selectPackage( res.value ); }
                LC.fillAll();
            },
            error: function( xhr ){
                LC.toast( xhr.responseJSON && xhr.responseJSON.message ? xhr.responseJSON.message : 'Could not add it' );
                input.trigger( 'focus' );
            }
        });
    },

    /**
     * @description Removes an IP or package from its list
     * @param {string} kind - 'ips' or 'packages'
     * @param {string} value
     * @returns {void}
     */
    removeHistory: function( kind, value ){
        if( !value ){
            return;
        }
        $.ajax({
            url: '/api/history/' + kind + '?value=' + encodeURIComponent( value ),
            type: 'DELETE',
            success: function( res ){
                LC.history = res.history;
                if( kind === 'ips' && value === LC.device ){ LC.selectDevice( '' ); }
                if( kind === 'packages' && value === LC.pkg ){ LC.selectPackage( '' ); }
                LC.fillAll();
                LC.toast( value + ' removed from the list', true );
            }
        });
    },

    // ───────────── device / package ─────────────

    /**
     * @description Opens a TV: the server connects it (and keeps it connected) and streams its logcat
     * @param {string} ip - '' = none
     * @returns {void}
     */
    selectDevice: function( ip ){
        LC.device = ip || '';
        LC.lines = [];
        LC.lastSeq = 0;
        LC.pids = new Set();
        LC.renderAll();
        LC.setStatus( LC.device ? 'connecting' : 'idle', '' );
        LC.send( { type: 'select', ip: LC.device } );
        if( LC.device && LC.pkg ){
            LC.send( { type: 'package', pkg: LC.pkg } );
        }
        LC.showPids();
        LC.remember();
    },

    /**
     * @description Selects a package (its PIDs are followed on the open TV)
     * @param {string} pkg - '' = none
     * @returns {void}
     */
    selectPackage: function( pkg ){
        LC.pkg = pkg || '';
        LC.pids = new Set();
        LC.updateOnlySwitch();
        LC.send( { type: 'package', pkg: LC.pkg } );
        LC.showPids();
        LC.remember();
        LC.renderAll();
    },

    /**
     * @description "Only this package" works only with a package selected
     * @returns {void}
     */
    updateOnlySwitch: function(){
        $( '#pkg_only' ).prop( 'disabled', LC.pkg === '' );
        $( '#only_wrap' ).toggleClass( 'disabled', LC.pkg === '' );
    },

    // ───────────── server connection ─────────────

    /**
     * @description WebSocket to the server; reconnects by itself
     * @returns {void}
     */
    connect: function(){
        LC.ws = new WebSocket( ( location.protocol === 'https:' ? 'wss://' : 'ws://' ) + location.host + '/ws' );
        LC.ws.onopen = function(){
            if( LC.device ){
                LC.selectDevice( LC.device );
            }
        };
        LC.ws.onmessage = function( event ){
            var message = null;   // Parsed message
            try{ message = JSON.parse( event.data ); } catch( e ){ return; }
            LC.onMessage( message );
        };
        LC.ws.onclose = function(){
            LC.setStatus( 'error', 'scodezy-logcat server not reachable - retrying' );
            setTimeout( LC.connect, 2000 );
        };
    },

    /**
     * @description Sends a message to the server (when connected)
     * @param {Object} message
     * @returns {void}
     */
    send: function( message ){
        if( LC.ws && LC.ws.readyState === 1 ){
            LC.ws.send( JSON.stringify( message ) );
        }
    },

    /**
     * @description Handles a server message
     * @param {Object} message
     * @returns {void}
     */
    onMessage: function( message ){
        if( message.type === 'state' && message.state.ip === LC.device ){
            LC.setStatus( message.state.status, message.state.detail );
            return;
        }
        if( message.type === 'backlog' && message.ip === LC.device ){
            LC.lines = message.lines.slice( -LC.MAX_CLIENT_LINES );
            LC.lastSeq = LC.lines.length ? LC.lines[ LC.lines.length - 1 ].i : 0;
            LC.renderAll();
            return;
        }
        if( message.type === 'lines' && message.ip === LC.device ){
            // A batch sent just after the backlog can repeat its last lines: keep only newer line numbers
            var fresh = $.grep( message.lines, function( line ){ return line.i > LC.lastSeq; } );
            if( fresh.length ){
                LC.lastSeq = fresh[ fresh.length - 1 ].i;
                LC.addLines( fresh );
            }
            return;
        }
        if( message.type === 'pids' && message.ip === LC.device && message.pkg === LC.pkg ){
            var before = LC.pids.size;   // Re-draw only when something changed
            LC.pids = new Set( message.pids );
            LC.showPids();
            if( LC.pids.size !== before ){
                LC.renderAll();
            }
            return;
        }
        if( message.type === 'error' ){
            LC.toast( message.message );
        }
    },

    // ───────────── filtering / drawing ─────────────

    /**
     * @description Applies the typed search text to the live logs
     * @returns {void}
     */
    applySearch: function(){
        LC.query = $.trim( $( '#search_input' ).val() );
        $( '#search_clear' ).toggleClass( 'hidden', LC.query === '' );
        LC.renderAll();
    },

    /**
     * @description Whether a line passes the package / level / search filters
     * @param {Object} line - { i, t, p, l }
     * @returns {boolean}
     */
    matches: function( line ){
        if( LC.pkg && $( '#pkg_only' ).is( ':checked' ) && !LC.pids.has( line.p ) ){
            return false;
        }
        var minLevel = LC.LEVELS.indexOf( $( '#level_select' ).val() );   // -1 = all
        if( minLevel > 0 && LC.LEVELS.indexOf( line.l ) < minLevel ){
            return false;
        }
        if( LC.query && line.t.toLowerCase().indexOf( LC.query.toLowerCase() ) < 0 ){
            return false;
        }
        return true;
    },

    /**
     * @description Escaped text with the search text highlighted
     * @param {string} text
     * @returns {string}
     */
    mark: function( text ){
        var html = LC.escape( text );   // Escaped text
        if( LC.query ){
            var pattern = new RegExp( '(' + LC.escape( LC.query ).replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) + ')', 'gi' );
            html = html.replace( pattern, '<mark>$1</mark>' );
        }
        return html;
    },

    /**
     * @description HTML of one line in columns: time, PID, level badge, tag, message
     * @param {Object} line
     * @returns {string}
     */
    lineHtml: function( line ){
        var m = line.t.match( LC.THREADTIME );   // Parts of a threadtime line
        if( !m ){
            return '<div class="ln raw">' + LC.mark( line.t ) + '</div>';
        }
        var mine = LC.pkg && LC.pids.has( line.p ) && !$( '#pkg_only' ).is( ':checked' );   // Tint the package's lines
        return '<div class="ln lv-' + m[ 4 ] + ( mine ? ' mine' : '' ) + '">' +
                   '<span class="c-time">' + LC.mark( m[ 1 ] ) + '</span>' +
                   '<span class="c-pid" title="TID ' + m[ 3 ] + '">' + LC.mark( m[ 2 ] ) + '</span>' +
                   '<span class="c-lv">' + m[ 4 ] + '</span>' +
                   '<span class="c-tag" title="' + LC.escape( m[ 5 ] ) + '">' + LC.mark( m[ 5 ] ) + '</span>' +
                   '<span class="c-msg">' + LC.mark( m[ 6 ] ) + '</span>' +
               '</div>';
    },

    /**
     * @description Redraws the log area from the lines kept in the page
     * @returns {void}
     */
    renderAll: function(){
        var matched = [];   // Lines passing the filters
        for( var i = LC.lines.length - 1; i >= 0 && matched.length < LC.MAX_DOM_LINES; i-- ){
            if( LC.matches( LC.lines[ i ] ) ){
                matched.push( LC.lines[ i ] );
            }
        }
        matched.reverse();
        $( '#log' ).html( $.map( matched, LC.lineHtml ).join( '' ) );
        LC.shown = matched.length;
        $( '#empty' ).toggleClass( 'hidden', LC.device !== '' );
        LC.showCounts();
        if( LC.autoScroll ){
            LC.scrollToEnd();
        }
    },

    /**
     * @description Adds new lines from the server and shows the ones passing the filters
     * @param {Object[]} lines
     * @returns {void}
     */
    addLines: function( lines ){
        Array.prototype.push.apply( LC.lines, lines );
        if( LC.lines.length > LC.MAX_CLIENT_LINES ){
            LC.lines.splice( 0, LC.lines.length - LC.MAX_CLIENT_LINES );
        }
        var html = '';   // New rows
        var added = 0;
        $.each( lines, function( i, line ){
            if( LC.matches( line ) ){
                html += LC.lineHtml( line );
                added++;
            }
        });
        if( added > 0 ){
            var log = $( '#log' );   // Log area
            log.append( html );
            LC.shown += added;
            if( LC.shown > LC.MAX_DOM_LINES ){
                log.children().slice( 0, LC.shown - LC.MAX_DOM_LINES ).remove();
                LC.shown = LC.MAX_DOM_LINES;
            }
            if( LC.autoScroll ){
                LC.scrollToEnd();
            }
        }
        LC.showCounts();
    },

    /**
     * @description Scrolls to the newest line
     * @returns {void}
     */
    scrollToEnd: function(){
        var el = $( '#log' )[ 0 ];   // Log area
        el.scrollTop = el.scrollHeight;
        $( '#jump_btn' ).addClass( 'hidden' );
    },

    /**
     * @description Line counts in the footer
     * @returns {void}
     */
    showCounts: function(){
        var text = LC.shown === LC.lines.length                                         // Footer text
            ? LC.lines.length.toLocaleString()
            : LC.shown.toLocaleString() + ' shown of ' + LC.lines.length.toLocaleString();
        if( LC.lines.length >= LC.MAX_CLIENT_LINES ){
            text += ' (latest ' + LC.MAX_CLIENT_LINES.toLocaleString() + ' in the page; Save has all)';
        }
        $( '#counts' ).text( text + ' lines' );
    },

    /**
     * @description PIDs of the selected package in the footer
     * @returns {void}
     */
    showPids: function(){
        var text = '';   // Footer text
        if( LC.pkg && LC.device ){
            text = LC.pids.size ? LC.pkg + '  \u00b7  PID ' + Array.from( LC.pids ).join( ', ' ) : LC.pkg + '  \u00b7  not running yet';
        }
        $( '#pids' ).text( text );
    },

    // ───────────── save / status / misc ─────────────

    /**
     * @description Downloads the logs of the open TV
     * @param {string} mode - 'filtered' or 'all'
     * @returns {void}
     */
    save: function( mode ){
        $( '#save_dialog' ).addClass( 'hidden' );
        window.location.href = '/api/save?' + $.param({
            ip: LC.device,
            mode: mode,
            pkg: LC.pkg,
            only: $( '#pkg_only' ).is( ':checked' ) ? '1' : '0',
            level: $( '#level_select' ).val(),
            q: LC.query
        });
    },

    /**
     * @description Status in the top bar
     * @param {string} status
     * @param {string} detail
     * @returns {void}
     */
    setStatus: function( status, detail ){
        var text = LC.STATUS_TEXT[ status ] || status;   // Shown text
        if( LC.device && ( status === 'connected' || status === 'connecting' || status === 'reconnecting' ) ){
            text += ' \u00b7 ' + LC.device;
        }
        $( '#status' ).attr( 'class', 'status status-' + status ).attr( 'title', detail || '' );
        $( '#status_text' ).text( text );
        if( status === 'unauthorized' || ( status === 'error' && detail ) ){
            LC.toast( detail || text );
        }
    },

    /**
     * @description Message at the bottom right
     * @param {string} text
     * @param {boolean} [ok] - Green instead of red
     * @returns {void}
     */
    toast: function( text, ok ){
        var toast = $( '#toast' );   // Toast element
        toast.text( text ).toggleClass( 'ok', !!ok ).removeClass( 'hidden' );
        clearTimeout( LC.toastTimer );
        LC.toastTimer = setTimeout( function(){ toast.addClass( 'hidden' ); }, 5000 );
    },

    /**
     * @description Remembers the choices in this browser (convenience only)
     * @returns {void}
     */
    remember: function(){
        try{
            localStorage.setItem( 'scodezy-logcat', JSON.stringify( { ip: LC.device, pkg: LC.pkg, only: $( '#pkg_only' ).is( ':checked' ), level: $( '#level_select' ).val() } ) );
        } catch( e ){}
    },

    /**
     * @description Restores the remembered choices
     * @returns {void}
     */
    restoreChoices: function(){
        var saved = {};   // Remembered choices
        try{ saved = JSON.parse( localStorage.getItem( 'scodezy-logcat' ) || '{}' ) || {}; } catch( e ){}
        $( '#level_select' ).val( saved.level || '' );
        $( '#pkg_only' ).prop( 'checked', !!saved.only );
        LC.pkg = saved.pkg && LC.history.packages.indexOf( saved.pkg ) >= 0 ? saved.pkg : '';
        LC.device = saved.ip && LC.history.ips.indexOf( saved.ip ) >= 0 ? saved.ip : '';
        LC.fillAll();
        LC.updateOnlySwitch();
        LC.showPids();
        $( '#empty' ).toggleClass( 'hidden', LC.device !== '' );
    },

    /**
     * @description Escapes text for HTML
     * @param {string} text
     * @returns {string}
     */
    escape: function( text ){
        return String( text ).replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' ).replace( /"/g, '&quot;' );
    }
};

$( function(){ LC.init(); } );
