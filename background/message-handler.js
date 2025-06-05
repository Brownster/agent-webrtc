/**
 * Message Handler Module for WebRTC Stats Exporter
 * Handles communication between content scripts and background worker
 */

/**
 * MessageHandler class for managing chrome.runtime.onMessage events
 */
class MessageHandler {
  constructor (statsFormatter, connectionSender, logger) {
    this.statsFormatter = statsFormatter
    this.connectionSender = connectionSender
    this.logger = logger
    this.options = {}
    this.messageHandlers = new Map()
    this.isInitialized = false
    this.messageListener = null
    this.resourceTracker = null
  }

  /**
   * Initialize the message handler and set up listeners
   * @param {Object} initialOptions - Initial options object
   * @returns {Promise<void>}
   */
  async initialize (initialOptions = {}) {
    if (this.isInitialized) {
      this.logger?.log('MessageHandler already initialized')
      return
    }

    try {
      this.options = { ...initialOptions }

      // Create resource tracker for cleanup management
      const LifecycleManager = globalThis.WebRTCExporterLifecycleManager || self.WebRTCExporterLifecycleManager
      if (LifecycleManager) {
        this.resourceTracker = LifecycleManager.createResourceTracker('MessageHandler', this.logger)
      } else {
        this.logger?.log('Warning: LifecycleManager not available, message listeners will not be tracked for cleanup')
      }

      // Set up default message handlers
      this._registerDefaultHandlers()

      // Create bound message listener
      this.messageListener = this._handleMessage.bind(this)

      // Set up Chrome message listener with cleanup tracking
      if (this.resourceTracker) {
        this.resourceTracker.registerChromeListener(chrome.runtime.onMessage, this.messageListener)
      } else {
        // Fallback to direct listener registration
        chrome.runtime.onMessage.addListener(this.messageListener)
      }

      this.isInitialized = true
      this.logger?.log('MessageHandler initialized successfully with resource tracking')
    } catch (error) {
      this.logger?.log(`MessageHandler initialization failed: ${error.message}`)
      throw new MessageHandlerError(`Failed to initialize message handler: ${error.message}`)
    }
  }

  /**
   * Update options (for reactive configuration changes)
   * @param {Object} newOptions - Updated options
   */
  updateOptions (newOptions) {
    this.options = { ...newOptions }
    this.logger?.log('MessageHandler options updated')
  }

  /**
   * Register a custom message handler
   * @param {string} eventType - Event type to handle
   * @param {Function} handler - Async handler function
   */
  registerHandler (eventType, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function')
    }

    this.messageHandlers.set(eventType, handler)
    this.logger?.log(`Registered message handler for: ${eventType}`)
  }

  /**
   * Unregister a message handler
   * @param {string} eventType - Event type to unregister
   */
  unregisterHandler (eventType) {
    const removed = this.messageHandlers.delete(eventType)
    if (removed) {
      this.logger?.log(`Unregistered message handler for: ${eventType}`)
    }
    return removed
  }

  /**
   * Get handler statistics
   * @returns {Object} Statistics about message handling
   */
  getStats () {
    return {
      isInitialized: this.isInitialized,
      registeredHandlers: Array.from(this.messageHandlers.keys()),
      handlerCount: this.messageHandlers.size
    }
  }

  /**
   * Handle peer connection stats message (main use case)
   * @param {Object} data - Message data
   * @param {string} data.url - Page URL
   * @param {string} data.id - Connection ID
   * @param {string} data.state - Connection state
   * @param {Object} data.values - Stats values
   * @returns {Promise<Object>} Response object
   */
  async handlePeerConnectionStats ({ url, id, state, values }) {
    try {
      this.logger?.log(`Processing peer connection stats: ${id} (${state})`)

      const origin = new URL(url).origin

      if (state === 'closed') {
        // Handle connection closure
        await this.connectionSender('DELETE', { id, origin })
        return { success: true, action: 'deleted' }
      }

      // Format stats using the stats formatter
      const data = this.statsFormatter.formatStats({
        url,
        state,
        values,
        agentId: this.options.agentId
      })

      if (data.length > 0) {
        // Send formatted data
        await this.connectionSender('POST', { id, origin }, data + '\n')
        return { success: true, action: 'sent', dataLength: data.length }
      } else {
        this.logger?.log(`No data to send for connection ${id}`)
        return { success: true, action: 'skipped', reason: 'no-data' }
      }
    } catch (error) {
      this.logger?.log(`Error handling peer connection stats: ${error.message}`)
      throw new MessageHandlerError(`Failed to process peer connection stats: ${error.message}`)
    }
  }

  /**
   * Send message to specific tab
   * @param {number} tabId - Tab ID
   * @param {Object} message - Message to send
   * @returns {Promise<Object>} Response from tab
   */
  async sendToTab (tabId, message) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message)
      return response
    } catch (error) {
      this.logger?.log(`Error sending message to tab ${tabId}: ${error.message}`)
      throw new MessageHandlerError(`Failed to send message to tab: ${error.message}`)
    }
  }

  /**
   * Broadcast message to all tabs
   * @param {Object} message - Message to broadcast
   * @returns {Promise<Array>} Array of responses
   */
  async broadcastToTabs (message) {
    try {
      const tabs = await chrome.tabs.query({})
      const responses = await Promise.allSettled(
        tabs.map(tab => this.sendToTab(tab.id, message))
      )
      
      return responses.map((result, index) => ({
        tabId: tabs[index].id,
        success: result.status === 'fulfilled',
        response: result.status === 'fulfilled' ? result.value : result.reason
      }))
    } catch (error) {
      this.logger?.log(`Error broadcasting message: ${error.message}`)
      throw new MessageHandlerError(`Failed to broadcast message: ${error.message}`)
    }
  }

  /**
   * Destroy the message handler and clean up resources
   */
  destroy () {
    if (this.resourceTracker) {
      this.resourceTracker.destroy()
      this.resourceTracker = null
      this.logger?.log('MessageHandler destroyed with resource cleanup')
    } else {
      // Note: Chrome extension APIs don't provide a way to remove the listener
      // It will be automatically cleaned up when the service worker restarts
      this.logger?.log('MessageHandler destroyed (no resource tracker available)')
    }
    
    this.messageHandlers.clear()
    this.isInitialized = false
    this.options = {}
    this.messageListener = null
  }

  // Private methods

  /**
   * Register default message handlers
   * @private
   */
  _registerDefaultHandlers () {
    // Register the main peer connection stats handler
    this.registerHandler('peer-connection-stats', async (data) => {
      return this.handlePeerConnectionStats(data)
    })
  }

  /**
   * Main message handler for chrome.runtime.onMessage
   * @private
   */
  async _handleMessage (message, sender, sendResponse) {
    try {
      // Validate message structure
      if (!message || typeof message !== 'object') {
        sendResponse({ error: 'Invalid message format' })
        return
      }

      const { event, data } = message

      if (!event) {
        sendResponse({ error: 'Missing event type' })
        return
      }

      // Get handler for this event type
      const handler = this.messageHandlers.get(event)

      if (!handler) {
        this.logger?.log(`No handler registered for event: ${event}`)
        sendResponse({ error: 'Unknown event type' })
        return
      }

      // Execute handler
      this.logger?.log(`Handling message event: ${event}`)
      const result = await handler(data, sender)

      // Send successful response
      sendResponse({ success: true, ...result })

    } catch (error) {
      this.logger?.log(`Message handler error: ${error.message}`)
      sendResponse({ error: error.message })
    }
  }
}

/**
 * Custom error class for message handler-related errors
 */
class MessageHandlerError extends Error {
  constructor (message) {
    super(message)
    this.name = 'MessageHandlerError'
  }
}

/**
 * Create a pre-configured MessageHandler instance
 * @param {Object} dependencies - Required dependencies
 * @param {Object} dependencies.statsFormatter - Stats formatter instance
 * @param {Function} dependencies.connectionSender - Function to send connection data
 * @param {Object} dependencies.logger - Logger instance (optional)
 * @returns {MessageHandler} Configured message handler
 */
function createMessageHandler ({ statsFormatter, connectionSender, logger }) {
  return new MessageHandler(statsFormatter, connectionSender, logger)
}

/**
 * Create and initialize message handler
 * @param {Object} dependencies - Required dependencies
 * @param {Object} initialOptions - Initial options for the handler
 * @returns {Promise<MessageHandler>} Initialized message handler
 */
async function createAndInitializeMessageHandler (dependencies, initialOptions = {}) {
  const handler = createMessageHandler(dependencies)
  await handler.initialize(initialOptions)
  return handler
}

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterMessageHandler = {
    MessageHandler,
    MessageHandlerError,
    createMessageHandler,
    createAndInitializeMessageHandler
  }
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterMessageHandler = {
    MessageHandler,
    MessageHandlerError,
    createMessageHandler,
    createAndInitializeMessageHandler
  }
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterMessageHandler = {
    MessageHandler,
    MessageHandlerError,
    createMessageHandler,
    createAndInitializeMessageHandler
  }
}
