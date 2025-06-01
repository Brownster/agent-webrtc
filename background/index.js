/* global chrome, pako */

/**
 * Main Orchestrator for WebRTC Stats Exporter
 * Coordinates initialization and communication between all modules
 */

// Import shared modules
importScripts('../assets/pako.min.js')
importScripts('../shared/config.js')
importScripts('../shared/domains.js')
importScripts('../shared/storage.js')
importScripts('stats-formatter.js')
importScripts('pushgateway-client.js')
importScripts('options-manager.js')
importScripts('connection-tracker.js')
importScripts('lifecycle-manager.js')
importScripts('tab-monitor.js')
importScripts('message-handler.js')

/**
 * Main Application Class - Orchestrates all modules
 */
class WebRTCExporterApp {
  constructor () {
    this.modules = {}
    this.options = {}
    this.logger = { log: this.log.bind(this) }
    this.isInitialized = false
  }

  /**
   * Logging function with consistent prefix
   * @param {...any} args - Arguments to log
   */
  log (...args) {
    console.log.apply(null, [self.WebRTCExporterConfig.CONSTANTS.LOGGING.PREFIX + ':background]', ...args])
  }

  /**
   * Initialize the entire application
   * @returns {Promise<void>}
   */
  async initialize () {
    try {
      this.log('WebRTC Stats Exporter starting...')

      // Initialize core modules first
      await this._initializeCoreModules()

      // Initialize options and dependent modules
      await this._initializeOptionsAndDependents()

      // Set up cross-module communication
      this._setupCrossModuleCommunication()

      this.isInitialized = true
      this.log('WebRTC Stats Exporter initialized successfully')

    } catch (error) {
      this.log('Application initialization failed:', error.message)
      // Fallback to default options to prevent complete failure
      Object.assign(this.options, self.WebRTCExporterConfig.DEFAULT_OPTIONS)
      throw error
    }
  }

  /**
   * Send data to Pushgateway with integrated tracking
   * @param {string} method - HTTP method (POST/DELETE)
   * @param {Object} connectionInfo - Connection info
   * @param {string} connectionInfo.id - Connection ID
   * @param {string} connectionInfo.origin - Origin domain
   * @param {string} [data] - Data to send
   * @returns {Promise<any>} Response from Pushgateway
   */
  async sendData (method, { id, origin }, data) {
    const { url, username, password, gzip, job } = this.options

    try {
      // Send data using pushgateway client
      const result = await this.modules.pushgatewayClient.sendData({
        method,
        url,
        job,
        id,
        username,
        password,
        gzip,
        data,
        statsCallback: this.modules.statsCallback
      })

      // Update connection tracking on successful requests
      await this.modules.connectionTracker.setPeerConnectionLastUpdate(
        { id, origin },
        method === 'POST' ? Date.now() : 0
      )

      // Trigger UI update after connection state change
      if (this.modules.tabMonitor) {
        await this.modules.tabMonitor.updateCurrentTab()
      }

      return result
    } catch (error) {
      this.log(`sendData error for ${method} ${id}: ${error.message}`)
      throw error
    }
  }

  /**
   * Get application statistics
   * @returns {Object} Application statistics
   */
  getStats () {
    const moduleStats = {}
    
    for (const [name, module] of Object.entries(this.modules)) {
      if (module && typeof module.getStats === 'function') {
        moduleStats[name] = module.getStats()
      }
    }

    return {
      isInitialized: this.isInitialized,
      moduleCount: Object.keys(this.modules).length,
      options: { ...this.options },
      modules: moduleStats
    }
  }

  /**
   * Gracefully shutdown the application
   */
  shutdown () {
    this.log('Shutting down WebRTC Stats Exporter...')
    
    // Destroy modules that support it
    for (const [name, module] of Object.entries(this.modules)) {
      if (module && typeof module.destroy === 'function') {
        try {
          module.destroy()
          this.log(`${name} destroyed successfully`)
        } catch (error) {
          this.log(`Error destroying ${name}: ${error.message}`)
        }
      }
    }

    this.modules = {}
    this.options = {}
    this.isInitialized = false
    this.log('Application shutdown complete')
  }

  // Private methods

  /**
   * Initialize core modules that don't depend on options
   * @private
   */
  async _initializeCoreModules () {
    // Initialize pushgateway client
    this.modules.pushgatewayClient = new self.WebRTCExporterPushgateway.PushgatewayClient()
    this.modules.statsCallback = self.WebRTCExporterPushgateway.createStatsCallback(chrome.storage)

    // Initialize options manager
    this.modules.optionsManager = self.WebRTCExporterOptionsManager.createOptionsManager({
      storageManager: self.WebRTCExporterStorage.StorageManager,
      config: self.WebRTCExporterConfig
    })

    // Initialize connection tracker with cleanup callback
    this.modules.connectionTracker = self.WebRTCExporterConnectionTracker.createConnectionTrackerWithCleanup({
      storageManager: self.WebRTCExporterStorage.StorageManager,
      logger: this.logger,
      config: self.WebRTCExporterConfig
    }, async ({ id, origin }) => {
      // Cleanup callback delegates to sendData
      return this.sendData('DELETE', { id, origin })
    })

    // Initialize lifecycle manager
    await self.WebRTCExporterLifecycle.createAndInitializeLifecycleManager({
      storageManager: self.WebRTCExporterStorage.StorageManager,
      config: self.WebRTCExporterConfig,
      logger: this.logger
    }, async (alarm) => {
      // Cleanup alarm handler
      return this.modules.connectionTracker.cleanupStaleConnections(this.options).catch((err) => {
        this.log(`cleanup peer connections error: ${err.message}`)
      })
    })

    this.log('Core modules initialized')
  }

  /**
   * Initialize options and modules that depend on them
   * @private
   */
  async _initializeOptionsAndDependents () {
    // Load options first
    const loadedOptions = await this.modules.optionsManager.initialize()
    Object.assign(this.options, loadedOptions)
    this.log('Options loaded')

    // Initialize tab monitor with loaded options
    this.modules.tabMonitor = await self.WebRTCExporterTabMonitor.createAndInitializeTabMonitor({
      domainManager: self.WebRTCExporterDomains.DomainManager,
      connectionTracker: this.modules.connectionTracker,
      logger: this.logger
    }, loadedOptions)
    this.log('TabMonitor initialized')

    // Update current tab with initial options
    await this.modules.tabMonitor.updateCurrentTab()

    // Initialize message handler
    this.modules.messageHandler = await self.WebRTCExporterMessageHandler.createAndInitializeMessageHandler({
      statsFormatter: self.WebRTCExporterStatsFormatter.StatsFormatter,
      connectionSender: this.sendData.bind(this),
      logger: this.logger
    }, this.options)
    this.log('MessageHandler initialized')

    this.log('Options-dependent modules initialized')
  }

  /**
   * Set up communication between modules for option changes
   * @private
   */
  _setupCrossModuleCommunication () {
    // Listen for options changes
    this.modules.optionsManager.onChange((changeInfo) => {
      // Update local options reference
      Object.assign(this.options, changeInfo.newOptions)
      this.log('Options changed')

      // Propagate changes to modules that need them
      if (this.modules.tabMonitor) {
        this.modules.tabMonitor.updateOptions(changeInfo.newOptions)
        this.modules.tabMonitor.updateCurrentTab().catch((err) => {
          this.log(`tab update error: ${err.message}`)
        })
      }

      if (this.modules.messageHandler) {
        this.modules.messageHandler.updateOptions(changeInfo.newOptions)
      }
    })

    this.log('Cross-module communication established')
  }
}

// Create and initialize the main application instance
const app = new WebRTCExporterApp()

// Start the application
app.initialize().catch((error) => {
  app.log('Fatal initialization error:', error.message)
})

// Export for potential external access (debugging, testing)
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterApp = app
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterApp = app
}

// Legacy compatibility - expose sendData function globally for any remaining dependencies
self.sendData = app.sendData.bind(app)