/* global chrome, importScripts */

// Import shared modules
importScripts('assets/pako.min.js')
importScripts('shared/config.js')
importScripts('shared/domains.js')
importScripts('shared/storage.js')
importScripts('shared/lifecycle-manager.js')
importScripts('background/stats-formatter.js')
importScripts('background/pushgateway-client.js')
importScripts('background/options-manager.js')
importScripts('background/connection-tracker.js')
importScripts('background/lifecycle-manager.js')
importScripts('background/tab-monitor.js')
importScripts('background/message-handler.js')

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

// Initialize lifecycle manager with cleanup handler
self.WebRTCExporterLifecycle.createAndInitializeLifecycleManager({
  storageManager: self.WebRTCExporterStorage.StorageManager,
  config: self.WebRTCExporterConfig,
  logger
}, async (_alarm) => {
  // Cleanup alarm handler - delegate to connection tracker
  return connectionTracker.cleanupStaleConnections(options).catch((err) => {
    log(`cleanup peer connections error: ${err.message}`)
  })
}).then((_lifecycleManager) => {
  log('LifecycleManager initialized successfully')
}).catch((error) => {
  log('LifecycleManager initialization failed:', error.message)
})

// For backward compatibility, keep options object that gets updated
const options = {}

// Store tab monitor reference for later use
let tabMonitorInstance = null

// Initialize options manager
optionsManager.initialize().then((loadedOptions) => {
  Object.assign(options, loadedOptions)
  log('options loaded')

  // Initialize tab monitor with initial options
  return self.WebRTCExporterTabMonitor.createAndInitializeTabMonitor({
    domainManager: self.WebRTCExporterDomains.DomainManager,
    connectionTracker,
    logger
  }, loadedOptions)
}).then((tabMonitor) => {
  tabMonitorInstance = tabMonitor
  log('TabMonitor initialized successfully')

  // Update current tab with initial options
  return tabMonitor.updateCurrentTab()
}).then(() => {
  // Initialize message handler
  return self.WebRTCExporterMessageHandler.createAndInitializeMessageHandler({
    statsFormatter: self.WebRTCExporterStatsFormatter.StatsFormatter,
    connectionSender: sendData,
    logger
  }, options)
}).then((messageHandler) => {
  log('MessageHandler initialized successfully')

  // Update message handler options when they change
  optionsManager.onChange((changeInfo) => {
    messageHandler.updateOptions(changeInfo.newOptions)
  })
}).catch((error) => {
  log('Error during initialization:', error.message)
  Object.assign(options, self.WebRTCExporterConfig.DEFAULT_OPTIONS)
})

// Listen for options changes through the manager
optionsManager.onChange((changeInfo) => {
  Object.assign(options, changeInfo.newOptions)
  log('options changed')

  // Update tab monitor with new options if it's initialized
  if (tabMonitorInstance) {
    tabMonitorInstance.updateOptions(changeInfo.newOptions)
    tabMonitorInstance.updateCurrentTab().catch((err) => {
      log(`tab update error: ${err.message}`)
    })
  }
})

// Listen for long-lived connections from content scripts
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'webrtc-stats-port') {
    return
  }

  log(`New stats port connected from tab ${port.sender?.tab?.id}`)

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'webrtc_stats_payload') {
      return
    }

    log('Received stats payload from port')

    try {
      const { url, id, state, values } = msg.data || {}
      const origin = new URL(url).origin

      if (state === 'closed') {
        await sendData('DELETE', { id, origin })
        return
      }

      const data = self.WebRTCExporterStatsFormatter.StatsFormatter.formatStats({
        url,
        state,
        values,
        agentId: options.agentId
      })

      if (data.length > 0) {
        await sendData('POST', { id, origin }, data + '\n')
      } else {
        log(`No data to send for connection ${id}`)
      }
    } catch (error) {
      log(`Error processing stats payload: ${error.message}`)
    }
  })

  port.onDisconnect.addListener(() => {
    log(`Stats port from tab ${port.sender?.tab?.id} disconnected.`)
  })
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
    if (tabMonitorInstance) {
      await tabMonitorInstance.updateCurrentTab()
    }

    return result
  } catch (error) {
    // Re-throw with additional context for debugging
    log(`sendData error for ${method} ${id}: ${error.message}`)
    throw error
  }
}

// Use quality limitation reasons from shared config
