/**
 * Options Manager Module for WebRTC Stats Exporter
 * Handles configuration loading, caching, validation, and change notifications
 */

/**
 * OptionsManager class for managing extension configuration
 */
class OptionsManager {
  constructor (storageManager, config) {
    this.storageManager = storageManager
    this.config = config
    this.options = {}
    this.changeListeners = new Set()
    this.loadListeners = new Set()
    this.isLoaded = false
    this.loadPromise = null
    this.storageUnsubscribe = null
  }

  /**
   * Initialize the options manager
   * @returns {Promise<Object>} Loaded options
   */
  initialize () {
    if (this.isLoaded) {
      return Promise.resolve(this.options)
    }

    if (this.loadPromise) {
      return this.loadPromise
    }

    this.loadPromise = this._loadOptions()
    return this.loadPromise
  }

  /**
   * Get current options (returns cached version if loaded)
   * @returns {Object} Current options
   */
  getOptions () {
    if (!this.isLoaded) {
      throw new Error('Options not loaded yet. Call initialize() first.')
    }
    return { ...this.options } // Return copy to prevent external mutation
  }

  /**
   * Get a specific option value
   * @param {string} key - Option key
   * @param {*} defaultValue - Default value if key doesn't exist
   * @returns {*} Option value
   */
  getOption (key, defaultValue = undefined) {
    if (!this.isLoaded) {
      throw new Error('Options not loaded yet. Call initialize() first.')
    }
    return this.options[key] !== undefined ? this.options[key] : defaultValue
  }

  /**
   * Update specific option(s)
   * @param {Object} updates - Options to update
   * @returns {Promise<void>}
   */
  async updateOptions (updates) {
    if (!this.isLoaded) {
      await this.initialize()
    }

    // Validate updates
    const validation = this._validateOptions(updates)
    if (!validation.isValid) {
      throw new OptionsError(`Invalid options: ${validation.errors.join(', ')}`)
    }

    // Update storage
    const currentOptions = await this.storageManager.getOptions()
    const newOptions = { ...currentOptions, ...updates }
    await this.storageManager.set(newOptions)

    // Note: The storage change handler will update our local cache
  }

  /**
   * Reload options from storage
   * @returns {Promise<Object>} Reloaded options
   */
  async reload () {
    this.isLoaded = false
    this.loadPromise = this._loadOptions()
    return this.loadPromise
  }

  /**
   * Add a listener for option changes
   * @param {Function} listener - Change listener function (receives { changed, options })
   * @returns {Function} Unsubscribe function
   */
  onChange (listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function')
    }

    this.changeListeners.add(listener)

    return () => {
      this.changeListeners.delete(listener)
    }
  }

  /**
   * Add a listener for initial options load
   * @param {Function} listener - Load listener function (receives options)
   * @returns {Function} Unsubscribe function
   */
  onLoad (listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function')
    }

    // If already loaded, call immediately
    if (this.isLoaded) {
      try {
        listener(this.getOptions())
      } catch (error) {
        console.warn('[OptionsManager] Error in load listener:', error)
      }
      return () => {} // No-op unsubscribe since already called
    }

    this.loadListeners.add(listener)

    return () => {
      this.loadListeners.delete(listener)
    }
  }

  /**
   * Check if options are loaded
   * @returns {boolean} True if options are loaded
   */
  isOptionsLoaded () {
    return this.isLoaded
  }

  /**
   * Get options statistics
   * @returns {Object} Statistics about options management
   */
  getStats () {
    const stats = {
      isLoaded: this.isLoaded,
      optionCount: Object.keys(this.options).length,
      changeListenerCount: this.changeListeners.size,
      loadListenerCount: this.loadListeners.size,
      hasStorageListener: !!this.storageUnsubscribe
    }

    // Add storage health information if available
    if (this.storageManager && typeof this.storageManager.getHealthStats === 'function') {
      stats.storageHealth = this.storageManager.getHealthStats()
    }

    return stats
  }

  /**
   * Destroy the options manager and clean up resources
   */
  destroy () {
    // Unsubscribe from storage changes
    if (this.storageUnsubscribe) {
      this.storageUnsubscribe()
      this.storageUnsubscribe = null
    }

    // Clear listeners
    this.changeListeners.clear()
    this.loadListeners.clear()

    // Reset state
    this.options = {}
    this.isLoaded = false
    this.loadPromise = null
  }

  // Private methods

  /**
   * Load options from storage
   * @private
   */
  async _loadOptions () {
    try {
      // Load options using storage manager
      const loadedOptions = await this.storageManager.getOptions()

      // Update internal state
      this.options = { ...loadedOptions }
      this.isLoaded = true

      // Set up storage change listener if not already done
      if (!this.storageUnsubscribe) {
        this.storageUnsubscribe = this.storageManager.onChanged((changes) => {
          this._handleStorageChange(changes)
        })
      }

      // Notify load listeners
      this._notifyLoadListeners(this.options)

      return this.options
    } catch (error) {
      // Fallback to default options on error
      console.warn('[OptionsManager] Error loading options, using defaults:', error)
      
      const defaultOptions = this.config ? { ...this.config.DEFAULT_OPTIONS } : {}
      this.options = defaultOptions
      this.isLoaded = true

      // Still set up storage listener for future changes
      if (!this.storageUnsubscribe) {
        this.storageUnsubscribe = this.storageManager.onChanged((changes) => {
          this._handleStorageChange(changes)
        })
      }

      // Notify load listeners with defaults
      this._notifyLoadListeners(this.options)

      return this.options
    }
  }

  /**
   * Handle storage changes
   * @private
   */
  _handleStorageChange (changes) {
    if (!this.isLoaded) {
      return // Ignore changes before initial load
    }

    const changedKeys = Object.keys(changes)
    const oldOptions = { ...this.options }

    // Update cached options
    for (const [key, { newValue }] of Object.entries(changes)) {
      this.options[key] = newValue
    }

    // Notify change listeners
    this._notifyChangeListeners({
      changed: changedKeys,
      oldOptions,
      newOptions: { ...this.options }
    })
  }

  /**
   * Notify change listeners
   * @private
   */
  _notifyChangeListeners (changeInfo) {
    for (const listener of this.changeListeners) {
      try {
        listener(changeInfo)
      } catch (error) {
        console.warn('[OptionsManager] Error in change listener:', error)
      }
    }
  }

  /**
   * Notify load listeners
   * @private
   */
  _notifyLoadListeners (options) {
    for (const listener of this.loadListeners) {
      try {
        listener({ ...options })
      } catch (error) {
        console.warn('[OptionsManager] Error in load listener:', error)
      }
    }

    // Clear load listeners after calling them
    this.loadListeners.clear()
  }

  /**
   * Validate options
   * @private
   */
  _validateOptions (options) {
    if (!this.config || !this.config.validateConfig) {
      return { isValid: true, errors: [] }
    }

    return this.config.validateConfig(options)
  }
}

/**
 * Custom error class for options-related errors
 */
class OptionsError extends Error {
  constructor (message) {
    super(message)
    this.name = 'OptionsError'
  }
}

/**
 * Create a pre-configured OptionsManager instance
 * @param {Object} dependencies - Required dependencies
 * @param {Object} dependencies.storageManager - Storage manager instance
 * @param {Object} dependencies.config - Config module reference
 * @returns {OptionsManager} Configured options manager
 */
function createOptionsManager ({ storageManager, config }) {
  return new OptionsManager(storageManager, config)
}

/**
 * Create an options manager with automatic initialization
 * @param {Object} dependencies - Required dependencies
 * @returns {Promise<OptionsManager>} Initialized options manager
 */
async function createAndInitializeOptionsManager (dependencies) {
  const manager = createOptionsManager(dependencies)
  await manager.initialize()
  return manager
}

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterOptionsManager = {
    OptionsManager,
    OptionsError,
    createOptionsManager,
    createAndInitializeOptionsManager
  }
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterOptionsManager = {
    OptionsManager,
    OptionsError,
    createOptionsManager,
    createAndInitializeOptionsManager
  }
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterOptionsManager = {
    OptionsManager,
    OptionsError,
    createOptionsManager,
    createAndInitializeOptionsManager
  }
}