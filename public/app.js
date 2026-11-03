// public/app.js - scodezy-logcat page logic (jQuery)

const LC = {

    MAX_CLIENT_LINES: 20000,      // Lines kept in the page (filters re-run over these)
    MAX_DOM_LINES: 3000,          // Lines shown at once
    LEVELS: [ 'V', 'D', 'I', 'W', 'E', 'F', 'A' ],   // Order of log levels
    STATUS_TEXT: {                // Status pill wording
        idle: 'No device', connecting: 'Connecting...', connected: 'Connected', reconnecting: 'Reconnecting...',
        unauthorized: 'Allow USB debugging on the TV', error: 'Error', stopped: 'Stopped'
    },

    ws: null,                     // WebSocket to the server
    device: '',                   // Open TV (IP)
    pkg: '',                      // Selected package
    pids: new Set(),              // PIDs of the selected package
    lines: [],                    // { i, t, p, l } received for the open TV
    shown: 0,                     // Lines on screen
    query: '',                    // Applied search text
    autoScroll: true,             // Follow new lines

    /**
     * @description Starts the page: history, handlers, WebSocket, remembered choices
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
        $( '#ip_add' ).on( 'click', function(){ LC.addHistory( 'ips', $( '#ip_input' ) ); } );
        $( '#pkg_add' ).on( 'click', function(){ LC.addHistory( 'packages', $( '#pkg_input' ) ); } );
        $( '#ip_input' ).on( 'keydown', function( e ){ if( e.key === 'Enter' ){ LC.addHistory( 'ips', $( this ) ); } } );
        $( '#pkg_input' ).on( 'keydown', function( e ){ if( e.key === 'Enter' ){ LC.addHistory( 'packages', $( this ) ); } } );
        $( '#ip_remove' ).on( 'click', function(){ LC.removeHistory( 'ips', $( '#ip_select' ).val() ); } );
        $( '#pkg_remove' ).on( 'click', function(){ LC.removeHistory( 'packages', $( '#pkg_select' ).val() ); } );

        $( '#ip_select' ).on( 'change', function(){ LC.selectDevice( $( this ).val() ); } );
        $( '#pkg_select' ).on( 'change', function(){ LC.selectPackage( $( this ).val() ); } );
        $( '#pkg_only' ).on( 'change', function(){ LC.remember(); LC.renderAll(); } );
        $( '#level_select' ).on( 'change', function(){ LC.remember(); LC.renderAll(); } );

        $( '#search_btn' ).on( 'click', LC.applySearch );
        $( '#search_input' ).on( 'keydown', function( e ){ if( e.key === 'Enter' ){ LC.applySearch(); } } );
        $( '#search_clear' ).on( 'click', function(){ $( '#search_input' ).val( '' ); LC.applySearch(); } );

        $( '#clear_btn' ).on( 'click', function(){ LC.lines = []; LC.renderAll(); } );
        $( '#jump_btn' ).on( 'click', function(){ LC.autoScroll = true; LC.scrollToEnd(); } );
        $( '#log' ).on( 'scroll', function(){
            var el = this;   // Log area
            LC.autoScroll = ( el.scrollHeight - el.scrollTop - el.clientHeight ) < 40;
            $( '#jump_btn' ).toggleClass( 'hidden', LC.autoScroll );
        });

        $( '#save_btn' ).on( 'click', function(){
            if( !LC.device ){
                LC.toast( 'Select a device first' );
                return;
            }
            $( '#save_dialog' ).removeClass( 'hidden' );
        });
        $( '#save_filtered' ).on( 'click', function(){ LC.save( 'filtered' ); } );
        $( '#save_all' ).on( 'click', function(){ LC.save( 'all' ); } );
        $( '#save_cancel' ).on( 'click', function(){ $( '#save_dialog' ).addClass( 'hidden' ); } );
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
            LC.fillHistory( res.history );
            if( done ){ done(); }
        }).fail( function(){
            LC.toast( 'The scodezy-logcat server does not answer' );
        });
    },

    /**
     * @description Fills both dropdowns, keeping the current selection
     * @param {Object} history - { ips, packages }
     * @returns {void}
     */
    fillHistory: function( history ){
        LC.fillSelect( $( '#ip_select' ), history.ips, 'Select a device', LC.device );
        LC.fillSelect( $( '#pkg_select' ), history.packages, 'No package', LC.pkg );
    },

    /**
     * @description Fills one dropdown
     * @param {jQuery} select
     * @param {string[]} values
     * @param {string} emptyText - First option
     * @param {string} current - Value to keep selected
     * @returns {void}
     */
    fillSelect: function( select, values, emptyText, current ){
        select.empty().append( $( '<option>' ).val( '' ).text( emptyText ) );
        $.each( values, function( i, value ){
            select.append( $( '<option>' ).val( value ).text( value ) );
        });
        select.val( current && values.indexOf( current ) >= 0 ? current : '' );
    },

    /**
     * @description Adds the typed IP or package to its list and selects it
     * @param {string} kind - 'ips' or 'packages'
     * @param {jQuery} input
     * @returns {void}
     */
    addHistory: function( kind, input ){
        var value = $.trim( input.val() );   // Typed value
        if( value === '' ){
            return;
        }
        $.ajax({
            url: '/api/history/' + kind,
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify( { value: value } ),
            success: function( res ){
                input.val( '' );
                LC.fillHistory( res.history );
                if( kind === 'ips' ){
                    $( '#ip_select' ).val( res.value );
                    LC.selectDevice( res.value );
                } else {
                    $( '#pkg_select' ).val( res.value );
                    LC.selectPackage( res.value );
                }
            },
            error: function( xhr ){
                LC.toast( xhr.responseJSON && xhr.responseJSON.message ? xhr.responseJSON.message : 'Could not add it' );
            }
        });
    },

    /**
     * @description Removes the selected IP or package from its list
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
                if( kind === 'ips' && value === LC.device ){
                    LC.selectDevice( '' );
                }
                if( kind === 'packages' && value === LC.pkg ){
                    LC.selectPackage( '' );
                }
                LC.fillHistory( res.history );
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
        LC.pids = new Set();
        LC.renderAll();
        LC.setStatus( LC.device ? 'connecting' : 'idle', '' );
        LC.send( { type: 'select', ip: LC.device } );
        if( LC.device && LC.pkg ){
            LC.send( { type: 'package', pkg: LC.pkg } );
        }
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
        $( '#pkg_only' ).prop( 'disabled', LC.pkg === '' );
        $( '#pkg_only' ).closest( '.check' ).toggleClass( 'disabled', LC.pkg === '' );
        LC.send( { type: 'package', pkg: LC.pkg } );
        LC.showPids();
        LC.remember();
        LC.renderAll();
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
            LC.renderAll();
            return;
        }
        if( message.type === 'lines' && message.ip === LC.device ){
            LC.addLines( message.lines );
            return;
        }
        if( message.type === 'pids' && message.ip === LC.device && message.pkg === LC.pkg ){
            var before = LC.pids.size;   // To re-draw only when something changed
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
     * @description HTML of one line (search text highlighted, selected package marked)
     * @param {Object} line
     * @returns {string}
     */
    lineHtml: function( line ){
        var html = LC.escape( line.t );   // Escaped text
        if( LC.query ){
            var pattern = new RegExp( '(' + LC.escape( LC.query ).replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) + ')', 'gi' );
            html = html.replace( pattern, '<mark>$1</mark>' );
        }
        var mine = LC.pkg && LC.pids.has( line.p ) && !$( '#pkg_only' ).is( ':checked' );   // Mark the package's lines
        return '<div class="ln ' + ( line.l || '' ) + ( mine ? ' mine' : '' ) + '">' + html + '</div>';
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
     * @description Line counts under the controls
     * @returns {void}
     */
    showCounts: function(){
        $( '#counts' ).text( LC.shown + ' shown of ' + LC.lines.length + ' received' + ( LC.lines.length >= LC.MAX_CLIENT_LINES ? ' (page keeps the latest ' + LC.MAX_CLIENT_LINES + '; Save has all)' : '' ) );
    },

    /**
     * @description PIDs of the selected package
     * @returns {void}
     */
    showPids: function(){
        $( '#pids' ).text( LC.pkg ? ( LC.pids.size ? LC.pkg + ' PID ' + Array.from( LC.pids ).join( ', ' ) : LC.pkg + ' not running yet' ) : '' );
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
     * @description Status pill
     * @param {string} status
     * @param {string} detail
     * @returns {void}
     */
    setStatus: function( status, detail ){
        $( '#status' ).attr( 'class', 'pill pill-' + status ).text( LC.STATUS_TEXT[ status ] || status ).attr( 'title', detail || '' );
        if( status === 'unauthorized' || ( status === 'error' && detail ) ){
            LC.toast( detail || LC.STATUS_TEXT[ status ] );
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
        LC.toastTimer = setTimeout( function(){ toast.addClass( 'hidden' ); }, 6000 );
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
        if( saved.pkg && $( '#pkg_select option[value="' + saved.pkg + '"]' ).length ){
            $( '#pkg_select' ).val( saved.pkg );
            LC.pkg = saved.pkg;
        }
        $( '#pkg_only' ).prop( 'disabled', LC.pkg === '' );
        if( saved.ip && $( '#ip_select option[value="' + saved.ip + '"]' ).length ){
            $( '#ip_select' ).val( saved.ip );
            LC.device = saved.ip;
        }
        LC.showPids();
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
