(function () {
    'use strict'
    const LOG_PREFIX = '[webrtc-exporter:override]'
    console.log(LOG_PREFIX, 'Unified override script running.')

    // --- State ---
    const OriginalRTCPeerConnection = window.RTCPeerConnection
    if (!OriginalRTCPeerConnection) {
        console.warn(LOG_PREFIX, 'window.RTCPeerConnection not found. Aborting.')
        return
    }

    let activeAdapterShim = OriginalRTCPeerConnection
    let isContentScriptReady = false
    const statsQueue = []

    // --- Communication ---
    function postToContentScript (type, detail) {
        try {
            window.postMessage({
                source: 'webrtc-exporter-override',
                type,
                detail
            }, '*')
        } catch (e) {
            console.error(LOG_PREFIX, 'postMessage failed:', e)
        }
    }

    function flushQueue () {
        while (statsQueue.length > 0) {
            const item = statsQueue.shift()
            postToContentScript(item.type, item.detail)
        }
    }

    window.addEventListener('message', (event) => {
        if (event.source === window && event.data && event.data.type === 'CS_READY') {
            console.log(LOG_PREFIX, 'Content script is ready. Flushing queue.')
            isContentScriptReady = true
            flushQueue()
        }
    })

    function sendOrQueue (type, detail) {
        if (isContentScriptReady) {
            postToContentScript(type, detail)
        } else {
            console.log(LOG_PREFIX, 'Content script not ready. Queuing message:', type)
            statsQueue.push({ type, detail })
        }
    }

    // --- The Proxy ---
    const RTCPeerConnectionProxy = function (...args) {
        console.log(LOG_PREFIX, 'PROXY CONSTRUCTOR CALLED.')
        const pc = new activeAdapterShim(...args)

        const peerConnectionId = pc.id || (pc.id = `pc_${Math.random().toString(36).substr(2, 9)}`)

        const originalGetStats = pc.getStats.bind(pc)
        pc.getStats = (...getStatsArgs) => {
            return originalGetStats(...getStatsArgs).then(stats => {
                const report = []
                stats.forEach(value => report.push(value))
                sendOrQueue('STATS_REPORT', { peerConnectionId, report })
                return stats
            })
        }

        pc.addEventListener('iceconnectionstatechange', () => {
            sendOrQueue('STATE_CHANGE', { peerConnectionId, state: pc.iceConnectionState })
        })

        sendOrQueue('PC_CREATED', { peerConnectionId })
        return pc
    }

    // --- Interception Logic ---
    Object.defineProperty(window, 'RTCPeerConnection', {
        get: function () {
            return RTCPeerConnectionProxy
        },
        set: function (newValue) {
            console.log(LOG_PREFIX, 'SET intercepted. Adapting to shim.')
            activeAdapterShim = newValue
            Object.setPrototypeOf(RTCPeerConnectionProxy.prototype, newValue.prototype)
            RTCPeerConnectionProxy.prototype.constructor = RTCPeerConnectionProxy
        },
        configurable: true
    })

    console.log(LOG_PREFIX, 'Override complete. Awaiting calls.')
})()
