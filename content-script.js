/* global chrome */

if (window.location.protocol.startsWith('http')) {
  const log = (...args) => {
    try {
      if (localStorage.getItem('webrtc-internal-exporter:debug') === 'true') {
        console.log.apply(null, [
          '[webrtc-internal-exporter:content-script]',
          ...args
        ])
      }
    } catch (error) {
      // Ignore localStorage errors.
    }
  }

  // Always log injection to verify it's working
  console.log('[webrtc-internal-exporter:content-script] Content script loaded on', window.location.origin)

  const injectScript = (filePath) => {
    const head = document.querySelector('head')
    const script = document.createElement('script')
    script.setAttribute('type', 'text/javascript')
    script.setAttribute('src', filePath)
    head.appendChild(script)
  }

  setTimeout(() => injectScript(chrome.runtime.getURL('override.js')))

  // Handle options.
  const options = {
    url: '',
    enabled: true, // Auto-enable on target domains
    updateInterval: 2000,
    enabledStats: []
  }

  const sendOptions = () => {
    window.postMessage({
      event: 'webrtc-internal-exporter:options',
      options
    })
  }

  // Load domain manager for proper domain checking
  const domainManagerScript = document.createElement('script')
  domainManagerScript.src = chrome.runtime.getURL('shared/domains.js')
  domainManagerScript.onload = () => {
    // Now we can use domain manager
    chrome.storage.sync
      .get(['url', 'enabledOrigins', 'updateInterval', 'enabledStats'])
      .then((ret) => {
        log('options loaded:', ret)
        options.url = ret.url || ''
        // Use proper domain checking logic
        const DomainManager = window.WebRTCExporterDomains?.DomainManager
        if (DomainManager) {
          options.enabled = DomainManager.shouldAutoEnable(window.location.origin, ret.enabledOrigins || {})
        } else {
          // Fallback to simple check
          options.enabled = !(ret.enabledOrigins && ret.enabledOrigins[window.location.origin] === false)
        }
        options.updateInterval = (ret.updateInterval || 2) * 1000
        options.enabledStats = ret.enabledStats || ['inbound-rtp', 'remote-inbound-rtp', 'outbound-rtp']
        sendOptions()
      })
  }
  document.head.appendChild(domainManagerScript)

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return

      let changed = false
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (key === 'url') {
          options.url = newValue
          changed = true
        } else if (key === 'enabledOrigins') {
          // Use proper domain checking logic
          const DomainManager = window.WebRTCExporterDomains?.DomainManager
          if (DomainManager) {
            options.enabled = DomainManager.shouldAutoEnable(window.location.origin, newValue || {})
          } else {
            // Fallback to simple check
            options.enabled = newValue[window.location.origin] !== false
          }
          changed = true
        } else if (key === 'updateInterval') {
          options.updateInterval = newValue * 1000
          changed = true
        } else if (key === 'enabledStats') {
          options.enabledStats = newValue || ['inbound-rtp', 'remote-inbound-rtp', 'outbound-rtp']
          changed = true
        }
      }
      if (changed) {
        log('options changed:', options)
        sendOptions()
      }
    })

    // Handle stats messages.
    window.addEventListener('message', async (message) => {
      const { event, url, id, state, values } = message.data
      if (event === 'webrtc-internal-exporter:ready') {
        console.log('[webrtc-internal-exporter:content-script] Override script ready, sending options')
        sendOptions()
      } else if (event === 'webrtc-internal-exporter:peer-connection-stats') {
        console.log('[webrtc-internal-exporter:content-script] Received peer-connection-stats', { url, id, state, valuesCount: values?.length })
        log('peer-connection-stats', { url, id, state, values })
        try {
          const response = await chrome.runtime.sendMessage({
            event: 'peer-connection-stats',
            data: {
              url,
              id,
              state,
              values
            }
          })
          if (response?.error) {
            log(`error: ${response.error}`)
          } else {
            console.log('[webrtc-internal-exporter:content-script] Successfully sent stats to background')
          }
        } catch (error) {
          console.error('[webrtc-internal-exporter:content-script] Error sending stats to background:', error.message)
          log(`error: ${error.message}`)
        }
      }
    })
  } catch (error) {
    console.error(
      `[webrtc-internal-exporter:content-script] error: ${error.message}`,
      error
    )
  }
}
