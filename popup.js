/* global chrome */

// Use direct references to shared modules to avoid const declaration conflicts

async function updatePopup () {
  try {
    // Get current tab info
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (tab && tab.url) {
      const url = new URL(tab.url)
      document.getElementById('currentDomain').textContent = url.hostname

      // Check if current domain is supported using DomainManager
      const isSupported = window.WebRTCExporterDomains.DomainManager.isTargetDomain(tab.url)

      // Get options to check if domain is enabled
      const options = await window.WebRTCExporterStorage.StorageManager.getOptions()
      const isEnabled = isSupported && window.WebRTCExporterDomains.DomainManager.shouldAutoEnable(url.origin, options.enabledOrigins)

      const statusEl = document.getElementById('currentStatus')
      if (isEnabled) {
        statusEl.textContent = 'Active - Capturing WebRTC Stats'
        statusEl.className = 'status active'
      } else if (isSupported) {
        statusEl.textContent = 'Supported Domain - Disabled'
        statusEl.className = 'status inactive'
      } else {
        statusEl.textContent = 'Unsupported Domain'
        statusEl.className = 'status inactive'
      }
    } else {
      document.getElementById('currentDomain').textContent = 'Unknown'
      document.getElementById('currentStatus').textContent = 'No Active Tab'
      document.getElementById('currentStatus').className = 'status inactive'
    }

    // Get connection stats
    const localData = await window.WebRTCExporterStorage.StorageManager.getLocal([
      window.WebRTCExporterConfig.CONSTANTS.STORAGE_KEYS.PEER_CONNECTIONS_PER_ORIGIN,
      window.WebRTCExporterConfig.CONSTANTS.STORAGE_KEYS.MESSAGES_SENT,
      window.WebRTCExporterConfig.CONSTANTS.STORAGE_KEYS.BYTES_SENT
    ])

    // Count active connections for current origin and total
    const peerConnectionsPerOrigin = localData[window.WebRTCExporterConfig.CONSTANTS.STORAGE_KEYS.PEER_CONNECTIONS_PER_ORIGIN] || {}
    const currentOriginConnections = tab && tab.url ? (peerConnectionsPerOrigin[new URL(tab.url).origin] || 0) : 0
    const totalConnections = Object.values(peerConnectionsPerOrigin).reduce((sum, count) => sum + count, 0)

    // Show current origin connections primarily, with total in parentheses if different
    if (totalConnections > currentOriginConnections) {
      document.getElementById('activeConnections').textContent = `${currentOriginConnections} (${totalConnections} total)`
    } else {
      document.getElementById('activeConnections').textContent = currentOriginConnections
    }

    // Update stats
    document.getElementById('messagesSent').textContent = localData[window.WebRTCExporterConfig.CONSTANTS.STORAGE_KEYS.MESSAGES_SENT] || 0

    const bytes = localData[window.WebRTCExporterConfig.CONSTANTS.STORAGE_KEYS.BYTES_SENT] || 0
    const formattedBytes = formatBytes(bytes)
    document.getElementById('bytesSent').textContent = formattedBytes
  } catch (error) {
    console.error('Error updating popup:', error)
    document.getElementById('currentStatus').textContent = 'Error loading status'
    document.getElementById('currentStatus').className = 'status inactive'
  }
}

function formatBytes (bytes) {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function openOptions () {
  chrome.runtime.openOptionsPage()
}

async function enableDebug () {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          localStorage.setItem('webrtc-internal-exporter:debug', 'true')
          console.log('[WebRTC Exporter] Debug logging enabled. Reload the page to see debug messages.')
        }
      })
      alert('Debug logging enabled! Reload the page to see debug messages in the console.')
    }
  } catch (error) {
    console.error('Error enabling debug:', error)
  }
}

// Update popup when it opens
document.addEventListener('DOMContentLoaded', () => {
  updatePopup()

  // Add event listeners for buttons
  document.getElementById('openOptionsBtn').addEventListener('click', openOptions)
  document.getElementById('enableDebugBtn').addEventListener('click', enableDebug)
  document.getElementById('closeBtn').addEventListener('click', () => window.close())
})
