/* global chrome, pako */

// Import shared modules
importScripts('assets/pako.min.js')
importScripts('shared/config.js')
importScripts('shared/domains.js')
importScripts('shared/storage.js')
importScripts('background/stats-formatter.js')
importScripts('background/pushgateway-client.js')
importScripts('background/options-manager.js')
importScripts('background/connection-tracker.js')

// Use direct references to avoid variable declarations that might conflict
// These reference the global objects set by the shared modules

function log (...args) {
  console.log.apply(null, [self.WebRTCExporterConfig.CONSTANTS.LOGGING.PREFIX + ':background]', ...args])
}

log('loaded')

// Initialize modules
const pushgatewayClient = new self.WebRTCExporterPushgateway.PushgatewayClient()
const statsCallback = self.WebRTCExporterPushgateway.createStatsCallback(chrome.storage)
const optionsManager = self.WebRTCExporterOptionsManager.createOptionsManager({
  storageManager: self.WebRTCExporterStorage.StorageManager,
  config: self.WebRTCExporterConfig
})

// Create logger object for connection tracker
const logger = { log }

// Initialize connection tracker with cleanup callback
const connectionTracker = self.WebRTCExporterConnectionTracker.createConnectionTrackerWithCleanup({
  storageManager: self.WebRTCExporterStorage.StorageManager,
  logger,
  config: self.WebRTCExporterConfig
}, async ({ id, origin }) => {
  // Cleanup callback - delegate to sendData DELETE
  return sendData('DELETE', { id, origin })
})

// For backward compatibility, keep options object that gets updated
const options = {}

// Handle install/update.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  log('onInstalled', reason)
  if (reason === 'install') {
    await chrome.storage.sync.set(self.WebRTCExporterConfig.DEFAULT_OPTIONS)
  } else if (reason === 'update') {
    const options = await chrome.storage.sync.get()
    await chrome.storage.sync.set({
      ...self.WebRTCExporterConfig.DEFAULT_OPTIONS,
      ...options
    })
  }

  await chrome.alarms.create(self.WebRTCExporterConfig.CONSTANTS.EXTENSION.ALARM_NAME, {
    delayInMinutes: self.WebRTCExporterConfig.CONSTANTS.UPDATE_INTERVALS.CLEANUP_INTERVAL_MINUTES,
    periodInMinutes: self.WebRTCExporterConfig.CONSTANTS.UPDATE_INTERVALS.CLEANUP_INTERVAL_MINUTES
  })
})

async function updateTabInfo (tab) {
  const tabId = tab.id
  const url = tab.url || tab.pendingUrl

  // Skip if no valid URL or it's a chrome:// page
  if (!url || !url.startsWith('http')) {
    chrome.action.setTitle({
      title: 'WebRTC Internals Exporter (no valid page)',
      tabId
    })
    chrome.action.setBadgeText({ text: '', tabId })
    return
  }

  const origin = self.WebRTCExporterDomains.DomainManager.extractOrigin(url)
  if (!origin) {
    log(`Invalid URL: ${url}`)
    return
  }

  const isTarget = self.WebRTCExporterDomains.DomainManager.isTargetDomain(url)
  const isEnabled = self.WebRTCExporterDomains.DomainManager.shouldAutoEnable(origin, options.enabledOrigins)

  if (isEnabled) {
    const stats = await connectionTracker.getConnectionStats()
    const peerConnections = stats.originCounts[origin] || 0

    chrome.action.setTitle({
      title: `WebRTC Internals Exporter\nActive Peer Connections: ${peerConnections}`,
      tabId
    })
    chrome.action.setBadgeText({ text: `${peerConnections}`, tabId })
    chrome.action.setBadgeBackgroundColor({ color: 'rgb(63, 81, 181)', tabId })
  } else {
    const reason = isTarget ? '(disabled)' : '(unsupported domain)'
    chrome.action.setTitle({
      title: `WebRTC Internals Exporter ${reason}`,
      tabId
    })
    chrome.action.setBadgeText({ text: '', tabId })
  }
}

async function optionsUpdated () {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  })
  await updateTabInfo(tab)
}

// Initialize options manager
optionsManager.initialize().then((loadedOptions) => {
  Object.assign(options, loadedOptions)
  log('options loaded')
  optionsUpdated()
}).catch((error) => {
  log('Error loading options:', error)
  Object.assign(options, self.WebRTCExporterConfig.DEFAULT_OPTIONS)
})

// Listen for options changes through the manager
optionsManager.onChange((changeInfo) => {
  Object.assign(options, changeInfo.newOptions)
  log('options changed')
  optionsUpdated()
})

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId)
    await updateTabInfo(tab)
  } catch (err) {
    log(`get tab error: ${err.message}`)
  }
})

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return
  try {
    const tab = await chrome.tabs.get(tabId)
    await updateTabInfo(tab)
  } catch (err) {
    log(`tab updated error: ${err.message}`)
  }
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === self.WebRTCExporterConfig.CONSTANTS.EXTENSION.ALARM_NAME) {
    connectionTracker.cleanupStaleConnections(options).catch((err) => {
      log(`cleanup peer connections error: ${err.message}`)
    })
  }
})

// Send data to pushgateway using the new client
async function sendData (method, { id, origin }, data) {
  const { url, username, password, gzip, job } = options

  try {
    const result = await pushgatewayClient.sendData({
      method,
      url,
      job,
      id,
      username,
      password,
      gzip,
      data,
      statsCallback
    })

    // Update peer connection tracking on successful requests
    await connectionTracker.setPeerConnectionLastUpdate(
      { id, origin },
      method === 'POST' ? Date.now() : 0
    )
    
    // Trigger UI update after connection state change
    await optionsUpdated()

    return result
  } catch (error) {
    // Re-throw with additional context for debugging
    log(`sendData error for ${method} ${id}: ${error.message}`)
    throw error
  }
}

// Use quality limitation reasons from shared config

/**
 * sendPeerConnectionStats
 * @param {string} url
 * @param {string} id
 * @param {RTCPeerConnectionState} state
 * @param {any} values
 */
async function sendPeerConnectionStats (url, id, state, values) {
  const origin = new URL(url).origin

  if (state === 'closed') {
    return sendData('DELETE', { id, origin })
  }

  // Use the new StatsFormatter module
  const data = self.WebRTCExporterStatsFormatter.StatsFormatter.formatStats({
    url,
    state,
    values,
    agentId: options.agentId
  })

  if (data.length > 0) {
    return sendData('POST', { id, origin }, data + '\n')
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.event === 'peer-connection-stats') {
    const { url, id, state, values } = message.data

    sendPeerConnectionStats(url, id, state, values)
      .then(() => {
        sendResponse({})
      })
      .catch((err) => {
        sendResponse({ error: err.message })
      })
  } else {
    sendResponse({ error: 'unknown event' })
  }

  return true
})
