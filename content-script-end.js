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

  // Create a long-lived connection to the background script for stats relaying
  const port = chrome.runtime.connect({ name: 'webrtc-stats-port' })

  port.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError) {
      console.log(`[webrtc-internal-exporter:content-script] Port disconnected due to an error: ${chrome.runtime.lastError.message}`)
    } else {
      console.log('[webrtc-internal-exporter:content-script] Port disconnected normally.')
    }
  })

  const injectScript = (filePath) => {
    const script = document.createElement('script')
    script.setAttribute('type', 'text/javascript')
    script.setAttribute('src', filePath)

    // Safely append to head when available
    const head = document.querySelector('head')
    if (head) {
      head.appendChild(script)
    } else {
      // Wait for head to be available
      const observer = new MutationObserver(() => {
        const head = document.querySelector('head')
        if (head) {
          observer.disconnect()
          head.appendChild(script)
        }
      })
      observer.observe(document, { childList: true, subtree: true })
    }
  }

  setTimeout(() => injectScript(chrome.runtime.getURL('override-stage2.js')))

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

    // For newer override scripts using the `type` field
    window.postMessage({
      type: 'webrtc-exporter-options',
      options
    })
  }

  // Load domain manager for proper domain checking
  const loadDomainManager = () => {
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

    // Safely append to head when available
    if (document.head) {
      document.head.appendChild(domainManagerScript)
    } else {
      // Wait for DOM to be ready
      const observer = new MutationObserver(() => {
        if (document.head) {
          observer.disconnect()
          document.head.appendChild(domainManagerScript)
        }
      })
      observer.observe(document, { childList: true, subtree: true })
    }
  }

  // Load domain manager when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadDomainManager)
  } else {
    loadDomainManager()
  }

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

    // Relay stats from injected page context to the background script
    window.addEventListener('webrtc-internal-exporter:stats-from-page', (event) => {
      const { url, id, state, values } = event.detail || {}
      console.log('[webrtc-internal-exporter:content-script] Caught stats from page, relaying to background.')
      log('peer-connection-stats', { url, id, state, values })
      try {
        port.postMessage({
          type: 'webrtc_stats_payload',
          data: { url, id, state, values }
        })
        console.log('[webrtc-internal-exporter:content-script] Relayed stats via persistent port.')
      } catch (error) {
        console.error('[webrtc-internal-exporter:content-script] Failed to send message, context was likely invalidated:', error)
        log(`error: ${error.message}`)
      }
    }, false)

    // Handle messages from override script (options and legacy stats events)
    window.addEventListener('message', (message) => {
      const { event, type, url, id, state, values } = message.data
      if (event === 'webrtc-internal-exporter:ready' || type === 'webrtc-exporter-ready') {
        console.log('[webrtc-internal-exporter:content-script] Override script ready, sending options')
        sendOptions()
      } else if (event === 'webrtc-internal-exporter:peer-connection-stats' || type === 'webrtc-exporter-peer-connection-stats') {
        console.log('[webrtc-internal-exporter:content-script] Received peer-connection-stats', { url, id, state, valuesCount: values?.length })
        log('peer-connection-stats', { url, id, state, values })
        try {
          port.postMessage({
            type: 'webrtc_stats_payload',
            data: {
              url,
              id,
              state,
              values
            }
          })
          console.log('[webrtc-internal-exporter:content-script] Relayed stats via persistent port.')
        } catch (error) {
          console.error('[webrtc-internal-exporter:content-script] Failed to send message, context was likely invalidated:', error)
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
