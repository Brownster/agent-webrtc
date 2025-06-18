(function() {
    'use strict';
    console.log('[webrtc-exporter:override] Unified override script running.');

    const OriginalRTCPeerConnection = window.RTCPeerConnection;
    if (!OriginalRTCPeerConnection) {
        console.warn('[webrtc-exporter:override] window.RTCPeerConnection not found. Aborting.');
        return;
    }

    let activeAdapterShim = OriginalRTCPeerConnection;

    const overrideId = Math.random().toString(36).substr(2, 9);

    function post(type, detail) {
        try {
            window.postMessage({
                source: 'webrtc-exporter-override',
                type,
                detail
            }, '*');
        } catch (e) {
            console.error('[webrtc-exporter:override] postMessage failed:', e);
        }
    }

    const RTCPeerConnectionProxy = function(...args) {
        console.log(`[webrtc-exporter:override ${overrideId}] PROXY CONSTRUCTOR CALLED.`);

        const pc = new activeAdapterShim(...args);

        post('PC_CREATED', {
            peerConnectionId: pc.id || (pc.id = `pc_${Math.random().toString(36).substr(2, 9)}`)
        });

        const originalGetStats = pc.getStats.bind(pc);
        pc.getStats = (...getStatsArgs) => {
            return originalGetStats(...getStatsArgs).then(stats => {
                const report = [];
                stats.forEach(value => report.push(value));
                post('STATS_REPORT', { peerConnectionId: pc.id, report });
                return stats;
            });
        };

        const originalSetter = pc.__lookupSetter__('oniceconnectionstatechange');
        Object.defineProperty(pc, 'oniceconnectionstatechange', {
            set: function(callback) {
                const newCallback = function(...cbArgs) {
                    post('STATE_CHANGE', { peerConnectionId: pc.id, state: pc.iceConnectionState });
                    if (callback) {
                        callback.apply(pc, cbArgs);
                    }
                };
                if (originalSetter) {
                    originalSetter.call(pc, newCallback);
                }
            },
            get: pc.__lookupGetter__('oniceconnectionstatechange')
        });

        return pc;
    };

    Object.defineProperty(window, 'RTCPeerConnection', {
        get: function() {
            console.log(`[webrtc-exporter:override ${overrideId}] GET intercepted. Returning proxy.`);
            return RTCPeerConnectionProxy;
        },
        set: function(newValue) {
            console.log(`[webrtc-exporter:override ${overrideId}] SET intercepted. Adapting to shim.`);
            activeAdapterShim = newValue;
            Object.setPrototypeOf(RTCPeerConnectionProxy.prototype, newValue.prototype);
            RTCPeerConnectionProxy.prototype.constructor = RTCPeerConnectionProxy;
        },
        configurable: true
    });

    console.log(`[webrtc-exporter:override ${overrideId}] Override complete. Awaiting calls.`);
})();
