(function () {
    'use strict'
    const LOG_PREFIX = '[webrtc-exporter:content-script]'
    console.log(LOG_PREFIX, 'Running at document_start.')

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
                console.warn(LOG_PREFIX, 'Port disconnected.')
                port = null
            })
            console.log(LOG_PREFIX, 'Port connected to background.')

            // Announce readiness to override script
            window.postMessage({ type: 'CS_READY' }, '*')
        } catch (error) {
            console.error(LOG_PREFIX, 'Could not connect to background script:', error)
            port = null
        }
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.source !== 'webrtc-exporter-override') {
            return
        }

        if (!port) connect()

        if (port) {
            try {
                port.postMessage(event.data)
            } catch (error) {
                console.error(LOG_PREFIX, 'Failed to relay message. Port may be closed.', error)
                port = null
            }
        } else {
            console.error(LOG_PREFIX, 'Port not available to relay message.')
        }
    })

    connect()
})()
