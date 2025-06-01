/**
 * Tab Monitor Module for WebRTC Stats Exporter
 * Handles tab event monitoring, badge updates, and domain checking
 */

/**
 * TabMonitor class for managing tab events and badge updates
 */
class TabMonitor {
  constructor (domainManager, connectionTracker, logger) {
    this.domainManager = domainManager
    this.connectionTracker = connectionTracker
    this.logger = logger
    this.options = {}
    this.isInitialized = false
    this.badgeConfig = {
      enabledColor: 'rgb(63, 81, 181)',
      textEmpty: '',
      titles: {
        noValidPage: 'WebRTC Internals Exporter (no valid page)',
        base: 'WebRTC Internals Exporter',
        activeConnections: 'WebRTC Internals Exporter\nActive Peer Connections',
        disabled: '(disabled)',
        unsupportedDomain: '(unsupported domain)'
      }
    }
  }

  /**
   * Initialize the tab monitor and set up event listeners
   * @param {Object} initialOptions - Initial options object
   * @returns {Promise<void>}
   */
  async initialize (initialOptions = {}) {
    if (this.isInitialized) {
      this.logger?.log('TabMonitor already initialized')
      return
    }

    try {
      this.options = { ...initialOptions }

      // Set up tab event listeners
      chrome.tabs.onActivated.addListener(this._handleTabActivated.bind(this))
      chrome.tabs.onUpdated.addListener(this._handleTabUpdated.bind(this))

      this.isInitialized = true
      this.logger?.log('TabMonitor initialized successfully')
    } catch (error) {
      this.logger?.log(`TabMonitor initialization failed: ${error.message}`)
      throw new TabMonitorError(`Failed to initialize tab monitor: ${error.message}`)
    }
  }

  /**
   * Update options (for reactive configuration changes)
   * @param {Object} newOptions - Updated options
   */
  updateOptions (newOptions) {
    this.options = { ...newOptions }
    this.logger?.log('TabMonitor options updated')
  }

  /**
   * Update tab information and badge for a specific tab
   * @param {Object} tab - Chrome tab object
   * @returns {Promise<void>}
   */
  async updateTabInfo (tab) {
    if (!tab || !tab.id) {
      this.logger?.log('Invalid tab object provided')
      return
    }

    const tabId = tab.id
    const url = tab.url || tab.pendingUrl

    try {
      // Skip if no valid URL or it's a chrome:// page
      if (!url || !url.startsWith('http')) {
        await this._setBadgeForInvalidPage(tabId)
        return
      }

      const origin = this.domainManager.extractOrigin(url)
      if (!origin) {
        this.logger?.log(`Invalid URL: ${url}`)
        return
      }

      const isTarget = this.domainManager.isTargetDomain(url)
      const isEnabled = this.domainManager.shouldAutoEnable(origin, this.options.enabledOrigins)

      if (isEnabled) {
        await this._setBadgeForEnabledDomain(tabId, origin)
      } else {
        await this._setBadgeForDisabledDomain(tabId, isTarget)
      }
    } catch (error) {
      this.logger?.log(`Error updating tab info for tab ${tabId}: ${error.message}`)
      await this._setBadgeForError(tabId)
    }
  }

  /**
   * Update the currently active tab
   * @returns {Promise<void>}
   */
  async updateCurrentTab () {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true
      })
      
      if (tab) {
        await this.updateTabInfo(tab)
      }
    } catch (error) {
      this.logger?.log(`Error updating current tab: ${error.message}`)
    }
  }

  /**
   * Update all tabs (useful for global option changes)
   * @returns {Promise<void>}
   */
  async updateAllTabs () {
    try {
      const tabs = await chrome.tabs.query({})
      
      await Promise.allSettled(
        tabs.map(tab => this.updateTabInfo(tab))
      )
      
      this.logger?.log(`Updated ${tabs.length} tabs`)
    } catch (error) {
      this.logger?.log(`Error updating all tabs: ${error.message}`)
    }
  }

  /**
   * Get tab monitoring statistics
   * @returns {Promise<Object>} Statistics about tab monitoring
   */
  async getStats () {
    try {
      const tabs = await chrome.tabs.query({})
      const httpTabs = tabs.filter(tab => tab.url && tab.url.startsWith('http'))
      const targetTabs = httpTabs.filter(tab => {
        const origin = this.domainManager.extractOrigin(tab.url)
        return origin && this.domainManager.isTargetDomain(tab.url)
      })
      const enabledTabs = httpTabs.filter(tab => {
        const origin = this.domainManager.extractOrigin(tab.url)
        return origin && this.domainManager.shouldAutoEnable(origin, this.options.enabledOrigins)
      })

      return {
        totalTabs: tabs.length,
        httpTabs: httpTabs.length,
        targetTabs: targetTabs.length,
        enabledTabs: enabledTabs.length,
        isInitialized: this.isInitialized
      }
    } catch (error) {
      this.logger?.log(`Error getting tab stats: ${error.message}`)
      return {
        totalTabs: 0,
        httpTabs: 0,
        targetTabs: 0,
        enabledTabs: 0,
        isInitialized: this.isInitialized,
        error: error.message
      }
    }
  }

  /**
   * Configure badge appearance
   * @param {Object} config - Badge configuration
   */
  configureBadge (config) {
    this.badgeConfig = { ...this.badgeConfig, ...config }
    this.logger?.log('Badge configuration updated')
  }

  /**
   * Clear badge for a specific tab
   * @param {number} tabId - Tab ID
   * @returns {Promise<void>}
   */
  async clearBadge (tabId) {
    try {
      await chrome.action.setBadgeText({ text: this.badgeConfig.textEmpty, tabId })
      await chrome.action.setTitle({ title: this.badgeConfig.titles.base, tabId })
    } catch (error) {
      this.logger?.log(`Error clearing badge for tab ${tabId}: ${error.message}`)
    }
  }

  /**
   * Destroy the tab monitor and clean up resources
   */
  destroy () {
    // Note: Chrome extension APIs don't provide a way to remove listeners
    // They will be automatically cleaned up when the service worker restarts
    this.isInitialized = false
    this.options = {}
    this.logger?.log('TabMonitor destroyed')
  }

  // Private methods

  /**
   * Handle tab activation events
   * @private
   */
  async _handleTabActivated ({ tabId }) {
    try {
      const tab = await chrome.tabs.get(tabId)
      await this.updateTabInfo(tab)
    } catch (error) {
      this.logger?.log(`Tab activation error: ${error.message}`)
    }
  }

  /**
   * Handle tab update events
   * @private
   */
  async _handleTabUpdated (tabId, changeInfo) {
    // Only process URL changes
    if (!changeInfo.url) return

    try {
      const tab = await chrome.tabs.get(tabId)
      await this.updateTabInfo(tab)
    } catch (error) {
      this.logger?.log(`Tab update error: ${error.message}`)
    }
  }

  /**
   * Set badge for invalid pages
   * @private
   */
  async _setBadgeForInvalidPage (tabId) {
    await chrome.action.setTitle({
      title: this.badgeConfig.titles.noValidPage,
      tabId
    })
    await chrome.action.setBadgeText({ text: this.badgeConfig.textEmpty, tabId })
  }

  /**
   * Set badge for enabled domains
   * @private
   */
  async _setBadgeForEnabledDomain (tabId, origin) {
    const stats = await this.connectionTracker.getConnectionStats()
    const peerConnections = stats.originCounts[origin] || 0

    await chrome.action.setTitle({
      title: `${this.badgeConfig.titles.activeConnections}: ${peerConnections}`,
      tabId
    })
    await chrome.action.setBadgeText({ text: `${peerConnections}`, tabId })
    await chrome.action.setBadgeBackgroundColor({ 
      color: this.badgeConfig.enabledColor, 
      tabId 
    })
  }

  /**
   * Set badge for disabled domains
   * @private
   */
  async _setBadgeForDisabledDomain (tabId, isTarget) {
    const reason = isTarget 
      ? this.badgeConfig.titles.disabled 
      : this.badgeConfig.titles.unsupportedDomain

    await chrome.action.setTitle({
      title: `${this.badgeConfig.titles.base} ${reason}`,
      tabId
    })
    await chrome.action.setBadgeText({ text: this.badgeConfig.textEmpty, tabId })
  }

  /**
   * Set badge for error states
   * @private
   */
  async _setBadgeForError (tabId) {
    await chrome.action.setTitle({
      title: `${this.badgeConfig.titles.base} (error)`,
      tabId
    })
    await chrome.action.setBadgeText({ text: '!', tabId })
  }
}

/**
 * Custom error class for tab monitor-related errors
 */
class TabMonitorError extends Error {
  constructor (message) {
    super(message)
    this.name = 'TabMonitorError'
  }
}

/**
 * Create a pre-configured TabMonitor instance
 * @param {Object} dependencies - Required dependencies
 * @param {Object} dependencies.domainManager - Domain manager instance
 * @param {Object} dependencies.connectionTracker - Connection tracker instance
 * @param {Object} dependencies.logger - Logger instance (optional)
 * @returns {TabMonitor} Configured tab monitor
 */
function createTabMonitor ({ domainManager, connectionTracker, logger }) {
  return new TabMonitor(domainManager, connectionTracker, logger)
}

/**
 * Create and initialize tab monitor
 * @param {Object} dependencies - Required dependencies
 * @param {Object} initialOptions - Initial options for the monitor
 * @returns {Promise<TabMonitor>} Initialized tab monitor
 */
async function createAndInitializeTabMonitor (dependencies, initialOptions = {}) {
  const monitor = createTabMonitor(dependencies)
  await monitor.initialize(initialOptions)
  return monitor
}

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterTabMonitor = {
    TabMonitor,
    TabMonitorError,
    createTabMonitor,
    createAndInitializeTabMonitor
  }
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterTabMonitor = {
    TabMonitor,
    TabMonitorError,
    createTabMonitor,
    createAndInitializeTabMonitor
  }
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterTabMonitor = {
    TabMonitor,
    TabMonitorError,
    createTabMonitor,
    createAndInitializeTabMonitor
  }
}