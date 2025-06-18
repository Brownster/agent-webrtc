// content-script.js
(function () {
    'use strict'
    const LOG_PREFIX = '[webrtc-exporter:content-script]'

    // --- Part 1: Injection ---
    const script = document.createElement('script')
    script.src = chrome.runtime.getURL('override.js')
    ;(document.head || document.documentElement).appendChild(script)
    script.onload = () => script.remove()
    console.log(LOG_PREFIX, 'Injected override script.')

    // --- Part 2: Communication Bridge ---
    let port = null

    function connect () {
        if (port) return
        try {
            port = chrome.runtime.connect({ name: 'webrtc-stats-port' })
            port.onDisconnect.addListener(() => {
                console.warn(LOG_PREFIX, 'Port disconnected from background.')
                port = null
            })
            console.log(LOG_PREFIX, 'Port connected to background.')
        } catch (error) {
            console.error(LOG_PREFIX, 'Failed to connect to background:', error)
            port = null
        }
    }

    // --- Part 3: Message Relay ---
    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.source !== 'webrtc-exporter-override') {
            return
        }

        if (!port) {
            connect()
        }

        if (port) {
            try {
                port.postMessage(event.data)
            } catch (error) {
                console.error(LOG_PREFIX, 'Failed to post message to background. Port is likely invalid.', error.message)
                port = null
            }
        } else {
            console.error(LOG_PREFIX, 'Cannot relay message, port is unavailable.')
        }
    })

    connect()
})()
