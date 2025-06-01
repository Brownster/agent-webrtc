/**
 * Storage abstraction layer for WebRTC Stats Exporter
 * Centralized storage management with error handling and validation
 */

/**
 * Storage management utility class
 * Provides consistent interface for Chrome extension storage with error handling
 */
class StorageManager {
  constructor () {
    this.circuitBreaker = null
    this.fallbackManager = null
    this.logger = null
    this._initializeCircuitBreaker()
  }

  /**
   * Initialize circuit breaker and fallback manager
   * @private
   */
  _initializeCircuitBreaker () {
    try {
      const CircuitBreakerModule = globalThis.WebRTCExporterStorageCircuitBreaker || 
                                   self.WebRTCExporterStorageCircuitBreaker ||
                                   window.WebRTCExporterStorageCircuitBreaker
      
      if (CircuitBreakerModule) {
        this.circuitBreaker = new CircuitBreakerModule.StorageCircuitBreaker(5, 60000)
        this.fallbackManager = new CircuitBreakerModule.StorageFallbackManager()
        
        if (this.logger) {
          this.circuitBreaker.setLogger(this.logger)
          this.fallbackManager.setLogger(this.logger)
        }
      }
    } catch (error) {
      console.warn('[StorageManager] Circuit breaker not available:', error.message)
    }
  }

  /**
   * Set logger for debugging
   * @param {Object} logger - Logger instance with log method
   */
  setLogger (logger) {
    this.logger = logger
    if (this.circuitBreaker) {
      this.circuitBreaker.setLogger(logger)
    }
    if (this.fallbackManager) {
      this.fallbackManager.setLogger(logger)
    }
  }
  /**
   * Get data from chrome.storage.sync with error handling
   * @param {string|string[]|Object} keys - Keys to retrieve
   * @returns {Promise<Object>} Retrieved data
   */
  async get (keys = null) {
    const operation = async () => {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[StorageManager] Chrome storage not available, using fallback')
        return this._getFallback(keys)
      }

      const result = await chrome.storage.sync.get(keys)

      // Validate retrieved configuration if getting all options
      if (!keys || (Array.isArray(keys) && keys.includes('url'))) {
        const config = globalThis.WebRTCExporterConfig || self.WebRTCExporterConfig || window.WebRTCExporterConfig
        if (config) {
          const validation = config.validateConfig(result)
          if (!validation.isValid) {
            console.warn('[StorageManager] Invalid config detected:', validation.errors)
            // Return defaults for invalid config
            return { ...config.DEFAULT_OPTIONS, ...result }
          }
        }
      }

      return result
    }

    try {
      if (this.circuitBreaker) {
        return await this.circuitBreaker.executeWithRetry(operation)
      } else {
        return await operation()
      }
    } catch (error) {
      console.error('[StorageManager] Error getting data from storage:', error)
      
      // Try fallback storage if available
      if (this.fallbackManager) {
        try {
          const fallbackData = await this.fallbackManager.getFallback(keys)
          console.warn('[StorageManager] Using fallback data due to storage error')
          return fallbackData
        } catch (fallbackError) {
          console.error('[StorageManager] Fallback also failed:', fallbackError.message)
        }
      }
      
      throw new StorageError('Failed to retrieve data from storage', error)
    }
  }

  /**
   * Set data to chrome.storage.sync with validation and error handling
   * @param {Object} data - Data to store
   * @returns {Promise<void>}
   */
  async set (data) {
    const operation = async () => {
      if (!data || typeof data !== 'object') {
        throw new Error('Data must be a non-null object')
      }

      // Validate configuration before storing
      const config = globalThis.WebRTCExporterConfig || self.WebRTCExporterConfig || window.WebRTCExporterConfig
      if (config) {
        const validation = config.validateConfig(data)
        if (!validation.isValid) {
          throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`)
        }
      }

      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[StorageManager] Chrome storage not available, using fallback')
        return this._setFallback(data)
      }

      await chrome.storage.sync.set(data)
      console.log('[StorageManager] Successfully saved configuration')
    }

    try {
      if (this.circuitBreaker) {
        await this.circuitBreaker.executeWithRetry(operation)
      } else {
        await operation()
      }
      
      // Also save to fallback for redundancy
      if (this.fallbackManager) {
        try {
          await this.fallbackManager.setFallback(data)
        } catch (fallbackError) {
          console.warn('[StorageManager] Fallback save failed:', fallbackError.message)
        }
      }
    } catch (error) {
      console.error('[StorageManager] Error setting data to storage:', error)
      
      // Try to save to fallback only if primary storage failed
      if (this.fallbackManager) {
        try {
          await this.fallbackManager.setFallback(data)
          console.warn('[StorageManager] Data saved to fallback storage only')
          return // Success via fallback
        } catch (fallbackError) {
          console.error('[StorageManager] Fallback save also failed:', fallbackError.message)
        }
      }
      
      throw new StorageError('Failed to save data to storage', error)
    }
  }

  /**
   * Get data from chrome.storage.local (for temporary/large data)
   * @param {string|string[]|Object} keys - Keys to retrieve
   * @returns {Promise<Object>} Retrieved data
   */
  async getLocal (keys = null) {
    const operation = async () => {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[StorageManager] Chrome storage not available, using fallback')
        return {}
      }

      return await chrome.storage.local.get(keys)
    }

    try {
      if (this.circuitBreaker) {
        return await this.circuitBreaker.executeWithRetry(operation)
      } else {
        return await operation()
      }
    } catch (error) {
      console.error('[StorageManager] Error getting local data:', error)
      throw new StorageError('Failed to retrieve local data', error)
    }
  }

  /**
   * Set data to chrome.storage.local
   * @param {Object} data - Data to store
   * @returns {Promise<void>}
   */
  async setLocal (data) {
    const operation = async () => {
      if (!data || typeof data !== 'object') {
        throw new Error('Data must be a non-null object')
      }

      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[StorageManager] Chrome storage not available')
        return
      }

      await chrome.storage.local.set(data)
    }

    try {
      if (this.circuitBreaker) {
        await this.circuitBreaker.executeWithRetry(operation)
      } else {
        await operation()
      }
    } catch (error) {
      console.error('[StorageManager] Error setting local data:', error)
      throw new StorageError('Failed to save local data', error)
    }
  }

  /**
   * Remove data from storage
   * @param {string|string[]} keys - Keys to remove
   * @returns {Promise<void>}
   */
  async remove (keys) {
    const operation = async () => {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        return
      }

      await chrome.storage.sync.remove(keys)
    }

    try {
      if (this.circuitBreaker) {
        await this.circuitBreaker.executeWithRetry(operation)
      } else {
        await operation()
      }
    } catch (error) {
      console.error('[StorageManager] Error removing data:', error)
      throw new StorageError('Failed to remove data from storage', error)
    }
  }

  /**
   * Clear all storage data
   * @returns {Promise<void>}
   */
  async clear () {
    const operation = async () => {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        return
      }

      await chrome.storage.sync.clear()
      await chrome.storage.local.clear()
    }

    try {
      if (this.circuitBreaker) {
        await this.circuitBreaker.executeWithRetry(operation)
      } else {
        await operation()
      }
      
      // Also clear fallback storage
      if (this.fallbackManager) {
        this.fallbackManager.clearFallback()
      }
    } catch (error) {
      console.error('[StorageManager] Error clearing storage:', error)
      throw new StorageError('Failed to clear storage', error)
    }
  }

  /**
   * Get merged options (defaults + stored)
   * @returns {Promise<Object>} Complete options object
   */
  async getOptions () {
    try {
      const config = globalThis.WebRTCExporterConfig || self.WebRTCExporterConfig || window.WebRTCExporterConfig
      const defaultOptions = config ? config.DEFAULT_OPTIONS : {}

      const stored = await this.get()
      const options = { ...defaultOptions, ...stored }

      // Ensure enabledStats is always an array
      if (options.enabledStats && !Array.isArray(options.enabledStats)) {
        options.enabledStats = Object.values(options.enabledStats || {})
      }

      return options
    } catch (error) {
      console.error('[StorageManager] Error getting options, using defaults:', error)
      const config = globalThis.WebRTCExporterConfig || self.WebRTCExporterConfig || window.WebRTCExporterConfig
      return config ? { ...config.DEFAULT_OPTIONS } : {}
    }
  }

  /**
   * Update specific option(s)
   * @param {Object} updates - Options to update
   * @returns {Promise<Object>} Updated complete options
   */
  async updateOptions (updates) {
    try {
      const current = await this.getOptions()
      const updated = { ...current, ...updates }
      await this.set(updated)
      return updated
    } catch (error) {
      console.error('[StorageManager] Error updating options:', error)
      throw error
    }
  }

  /**
   * Get statistics data
   * @returns {Promise<Object>} Statistics object
   */
  async getStats () {
    try {
      const config = globalThis.WebRTCExporterConfig || self.WebRTCExporterConfig || window.WebRTCExporterConfig
      const storageKeys = config ? config.CONSTANTS.STORAGE_KEYS : {}

      const keys = [
        storageKeys.PEER_CONNECTIONS_PER_ORIGIN,
        storageKeys.MESSAGES_SENT,
        storageKeys.BYTES_SENT,
        storageKeys.TOTAL_TIME,
        storageKeys.ERRORS
      ].filter(Boolean)

      return await this.getLocal(keys)
    } catch (error) {
      console.error('[StorageManager] Error getting stats:', error)
      return {}
    }
  }

  /**
   * Update statistics
   * @param {Object} stats - Statistics to update
   * @returns {Promise<void>}
   */
  async updateStats (stats) {
    try {
      await this.setLocal(stats)
    } catch (error) {
      console.error('[StorageManager] Error updating stats:', error)
      // Don't throw for stats errors to avoid breaking main functionality
    }
  }

  /**
   * Listen for storage changes
   * @param {Function} callback - Callback function for changes
   * @returns {Function} Unsubscribe function
   */
  onChanged (callback) {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return () => {} // Return empty unsubscribe function
    }

    const listener = (changes, areaName) => {
      if (areaName === 'sync') {
        callback(changes)
      }
    }

    chrome.storage.onChanged.addListener(listener)

    // Return unsubscribe function
    return () => {
      chrome.storage.onChanged.removeListener(listener)
    }
  }

  /**
   * Get circuit breaker and storage health statistics
   * @returns {Object} Storage health statistics
   */
  getHealthStats () {
    const stats = {
      circuitBreakerAvailable: !!this.circuitBreaker,
      fallbackManagerAvailable: !!this.fallbackManager
    }

    if (this.circuitBreaker) {
      stats.circuitBreaker = this.circuitBreaker.getStats()
    }

    if (this.fallbackManager) {
      stats.fallback = this.fallbackManager.getStats()
    }

    return stats
  }

  // Fallback methods for testing/development
  _getFallback (keys) {
    if (typeof localStorage === 'undefined') return {}

    try {
      const stored = localStorage.getItem('webrtc-exporter-config')
      const data = stored ? JSON.parse(stored) : {}

      if (!keys) return data
      if (typeof keys === 'string') return { [keys]: data[keys] }
      if (Array.isArray(keys)) {
        return keys.reduce((result, key) => {
          result[key] = data[key]
          return result
        }, {})
      }

      return data
    } catch (error) {
      console.error('[StorageManager] Fallback get error:', error)
      return {}
    }
  }

  _setFallback (data) {
    if (typeof localStorage === 'undefined') return

    try {
      const current = JSON.parse(localStorage.getItem('webrtc-exporter-config') || '{}')
      const updated = { ...current, ...data }
      localStorage.setItem('webrtc-exporter-config', JSON.stringify(updated))
    } catch (error) {
      console.error('[StorageManager] Fallback set error:', error)
    }
  }
}

/**
 * Custom error class for storage operations
 */
class StorageError extends Error {
  constructor (message, originalError) {
    super(message)
    this.name = 'StorageError'
    this.originalError = originalError
  }
}

/**
 * Create a configured StorageManager instance
 * @param {Object} logger - Logger instance (optional)
 * @returns {StorageManager} Configured storage manager
 */
function createStorageManager (logger = null) {
  const manager = new StorageManager()
  if (logger) {
    manager.setLogger(logger)
  }
  return manager
}

// Create default instance for backward compatibility
const defaultStorageManager = createStorageManager()

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterStorage = {
    StorageManager: defaultStorageManager, // Export instance for backward compatibility
    StorageManagerClass: StorageManager,   // Export class for new instances
    StorageError,
    createStorageManager
  }
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterStorage = {
    StorageManager: defaultStorageManager,
    StorageManagerClass: StorageManager,
    StorageError,
    createStorageManager
  }
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterStorage = {
    StorageManager: defaultStorageManager,
    StorageManagerClass: StorageManager,
    StorageError,
    createStorageManager
  }
}
