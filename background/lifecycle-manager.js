/**
 * Lifecycle Manager Module for WebRTC Stats Exporter
 * Handles extension installation, updates, alarms, and lifecycle events
 */

/**
 * LifecycleManager class for managing extension lifecycle events
 */
class LifecycleManager {
  constructor (storageManager, config, logger) {
    this.storageManager = storageManager
    this.config = config
    this.logger = logger
    this.alarmHandlers = new Map()
    this.isInitialized = false
  }

  /**
   * Initialize the lifecycle manager and set up event listeners
   * @returns {Promise<void>}
   */
  async initialize () {
    if (this.isInitialized) {
      this.logger?.log('LifecycleManager already initialized')
      return
    }

    try {
      // Set up install/update listener
      chrome.runtime.onInstalled.addListener(this._handleInstalled.bind(this))
      
      // Set up alarm listener  
      chrome.alarms.onAlarm.addListener(this._handleAlarm.bind(this))

      this.isInitialized = true
      this.logger?.log('LifecycleManager initialized successfully')
    } catch (error) {
      this.logger?.log(`LifecycleManager initialization failed: ${error.message}`)
      throw new LifecycleError(`Failed to initialize lifecycle manager: ${error.message}`)
    }
  }

  /**
   * Register a handler for a specific alarm
   * @param {string} alarmName - Name of the alarm
   * @param {Function} handler - Async function to handle the alarm
   */
  registerAlarmHandler (alarmName, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Alarm handler must be a function')
    }
    
    this.alarmHandlers.set(alarmName, handler)
    this.logger?.log(`Registered alarm handler for: ${alarmName}`)
  }

  /**
   * Unregister an alarm handler
   * @param {string} alarmName - Name of the alarm
   */
  unregisterAlarmHandler (alarmName) {
    const removed = this.alarmHandlers.delete(alarmName)
    if (removed) {
      this.logger?.log(`Unregistered alarm handler for: ${alarmName}`)
    }
    return removed
  }

  /**
   * Create an alarm with the given configuration
   * @param {string} name - Alarm name
   * @param {Object} config - Alarm configuration
   * @param {number} [config.delayInMinutes] - Initial delay
   * @param {number} [config.periodInMinutes] - Recurring period
   * @returns {Promise<void>}
   */
  async createAlarm (name, config = {}) {
    try {
      await chrome.alarms.create(name, config)
      this.logger?.log(`Created alarm: ${name}`, config)
    } catch (error) {
      this.logger?.log(`Failed to create alarm ${name}: ${error.message}`)
      throw new LifecycleError(`Failed to create alarm: ${error.message}`)
    }
  }

  /**
   * Clear an alarm
   * @param {string} name - Alarm name
   * @returns {Promise<boolean>} True if alarm was cleared
   */
  async clearAlarm (name) {
    try {
      const cleared = await chrome.alarms.clear(name)
      this.logger?.log(`Cleared alarm: ${name}, success: ${cleared}`)
      return cleared
    } catch (error) {
      this.logger?.log(`Failed to clear alarm ${name}: ${error.message}`)
      throw new LifecycleError(`Failed to clear alarm: ${error.message}`)
    }
  }

  /**
   * Get all active alarms
   * @returns {Promise<Array>} Array of alarm objects
   */
  async getAllAlarms () {
    try {
      const alarms = await chrome.alarms.getAll()
      return alarms
    } catch (error) {
      this.logger?.log(`Failed to get alarms: ${error.message}`)
      return []
    }
  }

  /**
   * Get information about a specific alarm
   * @param {string} name - Alarm name
   * @returns {Promise<Object|null>} Alarm object or null if not found
   */
  async getAlarm (name) {
    try {
      const alarm = await chrome.alarms.get(name)
      return alarm || null
    } catch (error) {
      this.logger?.log(`Failed to get alarm ${name}: ${error.message}`)
      return null
    }
  }

  /**
   * Setup default cleanup alarm using configuration
   * @returns {Promise<void>}
   */
  async setupDefaultAlarm () {
    if (!this.config?.CONSTANTS?.EXTENSION?.ALARM_NAME) {
      throw new LifecycleError('Missing alarm configuration in config')
    }

    const alarmName = this.config.CONSTANTS.EXTENSION.ALARM_NAME
    const intervalMinutes = this.config.CONSTANTS.UPDATE_INTERVALS?.CLEANUP_INTERVAL_MINUTES || 60

    await this.createAlarm(alarmName, {
      delayInMinutes: intervalMinutes,
      periodInMinutes: intervalMinutes
    })
  }

  /**
   * Handle fresh installation
   * @returns {Promise<void>}
   */
  async handleInstall () {
    this.logger?.log('Handling fresh extension installation')
    
    if (!this.config?.DEFAULT_OPTIONS) {
      throw new LifecycleError('Missing default options in config')
    }

    try {
      // Set default options
      await this.storageManager.set(this.config.DEFAULT_OPTIONS)
      this.logger?.log('Default options set successfully')

      // Setup cleanup alarm
      await this.setupDefaultAlarm()
      
      this.logger?.log('Extension installation completed successfully')
    } catch (error) {
      this.logger?.log(`Installation failed: ${error.message}`)
      throw new LifecycleError(`Installation failed: ${error.message}`)
    }
  }

  /**
   * Handle extension update
   * @returns {Promise<void>}
   */
  async handleUpdate () {
    this.logger?.log('Handling extension update')
    
    if (!this.config?.DEFAULT_OPTIONS) {
      throw new LifecycleError('Missing default options in config')
    }

    try {
      // Get existing options
      const existingOptions = await this.storageManager.getSync()
      
      // Merge with defaults (existing options take precedence)
      const mergedOptions = {
        ...this.config.DEFAULT_OPTIONS,
        ...existingOptions
      }
      
      // Update storage
      await this.storageManager.set(mergedOptions)
      this.logger?.log('Options updated successfully during extension update')

      // Ensure cleanup alarm exists
      await this.setupDefaultAlarm()
      
      this.logger?.log('Extension update completed successfully')
    } catch (error) {
      this.logger?.log(`Update failed: ${error.message}`)
      throw new LifecycleError(`Update failed: ${error.message}`)
    }
  }

  /**
   * Get lifecycle statistics
   * @returns {Object} Statistics about lifecycle management
   */
  getStats () {
    return {
      isInitialized: this.isInitialized,
      registeredAlarmHandlers: Array.from(this.alarmHandlers.keys()),
      handlerCount: this.alarmHandlers.size
    }
  }

  /**
   * Cleanup lifecycle manager resources
   */
  destroy () {
    this.alarmHandlers.clear()
    this.isInitialized = false
    this.logger?.log('LifecycleManager destroyed')
  }

  // Private methods

  /**
   * Handle chrome.runtime.onInstalled events
   * @private
   */
  async _handleInstalled ({ reason, previousVersion }) {
    try {
      this.logger?.log('onInstalled event:', { reason, previousVersion })
      
      if (reason === 'install') {
        await this.handleInstall()
      } else if (reason === 'update') {
        await this.handleUpdate()
      } else {
        this.logger?.log(`Unhandled install reason: ${reason}`)
      }
    } catch (error) {
      this.logger?.log(`Install handler error: ${error.message}`)
      // Don't re-throw to prevent extension from failing to load
    }
  }

  /**
   * Handle chrome.alarms.onAlarm events
   * @private
   */
  async _handleAlarm (alarm) {
    const handler = this.alarmHandlers.get(alarm.name)
    
    if (handler) {
      try {
        this.logger?.log(`Executing alarm handler for: ${alarm.name}`)
        await handler(alarm)
      } catch (error) {
        this.logger?.log(`Alarm handler error for ${alarm.name}: ${error.message}`)
        // Don't re-throw to prevent other alarms from failing
      }
    } else {
      this.logger?.log(`No handler registered for alarm: ${alarm.name}`)
    }
  }
}

/**
 * Custom error class for lifecycle-related errors
 */
class LifecycleError extends Error {
  constructor (message) {
    super(message)
    this.name = 'LifecycleError'
  }
}

/**
 * Create a pre-configured LifecycleManager instance
 * @param {Object} dependencies - Required dependencies
 * @param {Object} dependencies.storageManager - Storage manager instance
 * @param {Object} dependencies.config - Config module reference
 * @param {Object} dependencies.logger - Logger instance (optional)
 * @returns {LifecycleManager} Configured lifecycle manager
 */
function createLifecycleManager ({ storageManager, config, logger }) {
  return new LifecycleManager(storageManager, config, logger)
}

/**
 * Create and initialize lifecycle manager with default alarm handler
 * @param {Object} dependencies - Required dependencies
 * @param {Function} cleanupHandler - Function to call for cleanup alarm
 * @returns {Promise<LifecycleManager>} Initialized lifecycle manager
 */
async function createAndInitializeLifecycleManager (dependencies, cleanupHandler) {
  const manager = createLifecycleManager(dependencies)
  await manager.initialize()
  
  // Register default cleanup handler if provided
  if (cleanupHandler && dependencies.config?.CONSTANTS?.EXTENSION?.ALARM_NAME) {
    manager.registerAlarmHandler(
      dependencies.config.CONSTANTS.EXTENSION.ALARM_NAME,
      cleanupHandler
    )
  }
  
  return manager
}

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterLifecycle = {
    LifecycleManager,
    LifecycleError,
    createLifecycleManager,
    createAndInitializeLifecycleManager
  }
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterLifecycle = {
    LifecycleManager,
    LifecycleError,
    createLifecycleManager,
    createAndInitializeLifecycleManager
  }
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterLifecycle = {
    LifecycleManager,
    LifecycleError,
    createLifecycleManager,
    createAndInitializeLifecycleManager
  }
}