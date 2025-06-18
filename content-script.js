console.log('[webrtc-exporter:content-script] Injecting unified override script...')
const s = document.createElement('script')
s.src = chrome.runtime.getURL('override.js');
(document.head || document.documentElement).appendChild(s)
s.onload = () => s.remove()

const port = chrome.runtime.connect({ name: 'webrtc-stats-port' })
port.onDisconnect.addListener(() => { /* ... error handling ... */ })

window.addEventListener('webrtcStatsToRelay', (event) => {
  try {
    port.postMessage({
      type: 'webrtc_stats_payload',
      data: event.detail
    })
  } catch (e) {
    console.error('[content-script.js] Port postMessage failed:', e)
  }
}, false)
