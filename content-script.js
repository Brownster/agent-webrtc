(function() {
    'use strict';
    console.log('[webrtc-exporter:content-script] Running at document_start.');

    // --- Part 1: Injection ---
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('override.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
    console.log('[webrtc-exporter:content-script] Injected override script.');

    // --- Part 2: Communication Bridge ---
    let port = null;

    function connect() {
        if (port) return; // Already connected
        try {
            port = chrome.runtime.connect({ name: 'webrtc-stats-port' });
            port.onDisconnect.addListener(() => {
                console.warn('[webrtc-exporter:content-script] Port disconnected.');
                port = null;
            });
            console.log('[webrtc-exporter:content-script] Port connected to background.');
        } catch (error) {
            console.error('[webrtc-exporter:content-script] Could not connect to background script:', error);
            port = null;
        }
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || event.data.source !== 'webrtc-exporter-override') {
            return;
        }

        console.log('[webrtc-exporter:content-script] Received message from page:', event.data);
        if (!port) {
            connect();
        }
        if (port) {
            try {
                port.postMessage(event.data);
            } catch (error) {
                console.error('[webrtc-exporter:content-script] Failed to relay message to background. Port may be closed.', error);
                port = null;
            }
        } else {
            console.error('[webrtc-exporter:content-script] Port not available to relay message.');
        }
    });

    connect();
})();
