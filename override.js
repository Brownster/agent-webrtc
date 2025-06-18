// override.js
(function () {
    'use strict'
    const LOG_PREFIX = '[webrtc-exporter:override]'
    console.log(LOG_PREFIX, 'Unified override script running.')

    // Ensure this entire logic runs only once per page context
    if (window.__webrtc_exporter_installed__) {
        console.log(LOG_PREFIX, 'Already installed. Aborting.')
        return
    }
    window.__webrtc_exporter_installed__ = true

    // --- State Management ---
    const state = {
        OriginalRTCPeerConnection: window.RTCPeerConnection,
        activeAdapterShim: window.RTCPeerConnection,
        activePCs: new Map(),
        statsInterval: null,
        updateInterval: 2000
    }

    if (!state.OriginalRTCPeerConnection) {
        console.warn(LOG_PREFIX, 'window.RTCPeerConnection not found.')
        return
    }

    // --- Communication ---
    function postToContentScript (type, detail) {
        window.postMessage({
            source: 'webrtc-exporter-override',
            type,
            detail
        }, '*')
    }

    // --- Stats Polling ---
    function pollStats () {
        state.activePCs.forEach((pc, id) => {
            if (pc.connectionState === 'closed' || pc.iceConnectionState === 'closed') {
                console.log(LOG_PREFIX, `PC ${id} is closed. Removing from active list.`)
                state.activePCs.delete(id)
                postToContentScript('PC_CLOSED', { peerConnectionId: id })
                return
            }

            pc.getStats()
              .then(stats => {
                  const report = []
                  stats.forEach(value => report.push(value))
                  postToContentScript('STATS_REPORT', { peerConnectionId: id, report })
              })
              .catch(err => console.warn(LOG_PREFIX, `getStats for PC ${id} failed:`, err))
        })
    }

    function startPolling () {
        if (!state.statsInterval) {
            console.log(LOG_PREFIX, `Starting stats polling every ${state.updateInterval}ms.`)
            state.statsInterval = setInterval(pollStats, state.updateInterval)
        }
    }

    // --- The Proxy ---
    const RTCPeerConnectionProxy = function (...args) {
        console.log(LOG_PREFIX, 'PROXY CONSTRUCTOR CALLED.')
        const pc = new state.activeAdapterShim(...args)
        const peerConnectionId = `pc_${Math.random().toString(36).substr(2, 9)}`

        state.activePCs.set(peerConnectionId, pc)
        console.log(LOG_PREFIX, `New PC created and tracked: ${peerConnectionId}. Total active: ${state.activePCs.size}`)

        postToContentScript('PC_CREATED', { peerConnectionId })
        startPolling()

        return pc
    }

    // --- Interception & Shim Handling ---
    Object.defineProperty(window, 'RTCPeerConnection', {
        get: function () {
            return RTCPeerConnectionProxy
        },
        set: function (newValue) {
            console.log(LOG_PREFIX, 'SET intercepted. Adapting to shim.')
            state.activeAdapterShim = newValue
            Object.setPrototypeOf(RTCPeerConnectionProxy.prototype, newValue.prototype)
        },
        configurable: true
    })

    console.log(LOG_PREFIX, 'Override complete. Awaiting calls.')
})()
