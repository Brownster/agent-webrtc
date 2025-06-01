/**
 * Storage Circuit Breaker for WebRTC Stats Exporter
 * Implements circuit breaker pattern to handle storage failures gracefully
 */

/**
 * Storage Circuit Breaker class for preventing storage failure cascades
 * Uses three states: CLOSED (normal), OPEN (failing), HALF_OPEN (testing recovery)
 */
class StorageCircuitBreaker {
  constructor (failureThreshold = 5, resetTimeout = 60000) {
    this.failureThreshold = failureThreshold
    this.resetTimeout = resetTimeout
    this.failureCount = 0
    this.state = 'CLOSED' // CLOSED, OPEN, HALF_OPEN
    this.lastFailureTime = null
    this.successCount = 0
    this.logger = null
  }

  /**
   * Set logger for debugging
   * @param {Object} logger - Logger instance with log method
   */
  setLogger (logger) {
    this.logger = logger
  }

  /**
   * Log message with consistent prefix
   * @param {...any} args - Arguments to log
   */
  log (...args) {
    if (this.logger && typeof this.logger.log === 'function') {
      this.logger.log('[StorageCircuitBreaker]', ...args)
    }
  }

  /**
   * Execute a storage operation through the circuit breaker
   * @param {Function} operation - Storage operation to execute
   * @returns {Promise<any>} Operation result
   * @throws {StorageCircuitBreakerError} When circuit is open
   */
  async execute (operation) {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.state = 'HALF_OPEN'
        this.successCount = 0
        this.log('Circuit breaker transitioning to HALF_OPEN - testing recovery')
      } else {
        throw new StorageCircuitBreakerError('Storage circuit breaker is OPEN - operation blocked')
      }
    }

    try {
      const result = await operation()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure(error)
      throw error
    }
  }

  /**
   * Execute operation with retry logic and exponential backoff
   * @param {Function} operation - Storage operation to execute
   * @param {number} maxRetries - Maximum number of retries (default: 3)
   * @param {number} baseDelay - Base delay in milliseconds (default: 1000)
   * @returns {Promise<any>} Operation result
   */
  async executeWithRetry (operation, maxRetries = 3, baseDelay = 1000) {
    let lastError

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.execute(operation)
      } catch (error) {
        lastError = error

        // Don't retry if circuit breaker is open
        if (error instanceof StorageCircuitBreakerError) {
          throw error
        }

        // Don't retry on final attempt
        if (attempt === maxRetries) {
          break
        }

        // Don't retry client errors (4xx equivalent)
        if (this.isNonRetryableError(error)) {
          this.log(`Non-retryable error, not retrying: ${error.message}`)
          break
        }

        // Exponential backoff with jitter
        const delay = baseDelay * Math.pow(2, attempt)
        const jitter = Math.random() * 0.1 * delay
        const totalDelay = delay + jitter

        this.log(`Attempt ${attempt + 1} failed, retrying in ${Math.round(totalDelay)}ms: ${error.message}`)
        await this.delay(totalDelay)
      }
    }

    throw lastError
  }

  /**
   * Check if we should attempt to reset the circuit breaker
   * @returns {boolean} True if reset should be attempted
   * @private
   */
  shouldAttemptReset () {
    return this.lastFailureTime &&
           (Date.now() - this.lastFailureTime) >= this.resetTimeout
  }

  /**
   * Handle successful operation
   * @private
   */
  onSuccess () {
    if (this.state === 'HALF_OPEN') {
      this.successCount++
      // Require multiple successes to fully close the circuit
      if (this.successCount >= 2) {
        this.state = 'CLOSED'
        this.failureCount = 0
        this.successCount = 0
        this.lastFailureTime = null
        this.log('Circuit breaker CLOSED - storage operations restored')
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success
      this.failureCount = 0
    }
  }

  /**
   * Handle failed operation
   * @param {Error} error - The error that occurred
   * @private
   */
  onFailure (error) {
    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.state === 'HALF_OPEN') {
      // Any failure in HALF_OPEN immediately reopens the circuit
      this.state = 'OPEN'
      this.successCount = 0
      this.log(`Circuit breaker reopened due to failure in HALF_OPEN: ${error.message}`)
    } else if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      // Too many failures, open the circuit
      this.state = 'OPEN'
      this.log(`Circuit breaker OPENED after ${this.failureCount} failures. Last error: ${error.message}`)
    }
  }

  /**
   * Check if an error should not be retried
   * @param {Error} error - The error to check
   * @returns {boolean} True if error should not be retried
   * @private
   */
  isNonRetryableError (error) {
    const message = error.message.toLowerCase()

    // These are permanent errors that won't be fixed by retrying
    return message.includes('quota_exceeded') ||
           message.includes('invalid data') ||
           message.includes('permission denied') ||
           message.includes('extension context invalidated')
  }

  /**
   * Delay for the specified number of milliseconds
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   * @private
   */
  delay (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Get current circuit breaker statistics
   * @returns {Object} Circuit breaker statistics
   */
  getStats () {
    return {
      state: this.state,
      failureCount: this.failureCount,
      failureThreshold: this.failureThreshold,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      resetTimeout: this.resetTimeout,
      timeUntilReset: this.lastFailureTime
        ? Math.max(0, this.resetTimeout - (Date.now() - this.lastFailureTime))
        : 0
    }
  }

  /**
   * Manually reset the circuit breaker to CLOSED state
   * Use with caution - mainly for testing or administrative purposes
   */
  reset () {
    this.state = 'CLOSED'
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureTime = null
    this.log('Circuit breaker manually reset to CLOSED state')
  }

  /**
   * Manually open the circuit breaker
   * Use for maintenance or emergency situations
   */
  open () {
    this.state = 'OPEN'
    this.lastFailureTime = Date.now()
    this.log('Circuit breaker manually opened')
  }
}

/**
 * Custom error class for circuit breaker operations
 */
class StorageCircuitBreakerError extends Error {
  constructor (message) {
    super(message)
    this.name = 'StorageCircuitBreakerError'
  }
}

/**
 * Storage Fallback Manager for when primary storage fails
 */
class StorageFallbackManager {
  constructor () {
    this.memoryCache = new Map()
    this.logger = null
  }

  /**
   * Set logger for debugging
   * @param {Object} logger - Logger instance with log method
   */
  setLogger (logger) {
    this.logger = logger
  }

  /**
   * Log message with consistent prefix
   * @param {...any} args - Arguments to log
   */
  log (...args) {
    if (this.logger && typeof this.logger.log === 'function') {
      this.logger.log('[StorageFallbackManager]', ...args)
    }
  }

  /**
   * Store data in fallback storage (localStorage + memory)
   * @param {Object} data - Data to store
   * @returns {Promise<void>}
   */
  async setFallback (data) {
    try {
      // Store in memory cache first
      for (const [key, value] of Object.entries(data)) {
        this.memoryCache.set(key, value)
      }

      // Try to store in localStorage as well
      if (typeof localStorage !== 'undefined') {
        const serialized = JSON.stringify(data)
        localStorage.setItem('webrtc-exporter-fallback', serialized)
        this.log('Data stored in localStorage fallback')
      }

      this.log(`Data stored in memory fallback: ${Object.keys(data).join(', ')}`)
    } catch (error) {
      this.log(`Fallback storage failed: ${error.message}`)
      // Memory cache should still work
    }
  }

  /**
   * Retrieve data from fallback storage
   * @param {string|string[]|null} keys - Keys to retrieve
   * @returns {Promise<Object>} Retrieved data
   */
  async getFallback (keys = null) {
    try {
      let data = {}

      // First try localStorage
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('webrtc-exporter-fallback')
        if (stored) {
          data = JSON.parse(stored)
          this.log('Data loaded from localStorage fallback')
        }
      }

      // Merge with memory cache (memory cache takes precedence)
      for (const [key, value] of this.memoryCache) {
        data[key] = value
      }

      // Filter keys if specified
      if (keys) {
        if (typeof keys === 'string') {
          return { [keys]: data[keys] }
        } else if (Array.isArray(keys)) {
          return keys.reduce((result, key) => {
            result[key] = data[key]
            return result
          }, {})
        }
      }

      return data
    } catch (error) {
      this.log(`Fallback retrieval failed: ${error.message}`)
      // Return memory cache only
      const memoryData = {}
      for (const [key, value] of this.memoryCache) {
        memoryData[key] = value
      }
      return memoryData
    }
  }

  /**
   * Clear all fallback storage
   */
  clearFallback () {
    this.memoryCache.clear()

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('webrtc-exporter-fallback')
      }
      this.log('Fallback storage cleared')
    } catch (error) {
      this.log(`Error clearing fallback storage: ${error.message}`)
    }
  }

  /**
   * Get fallback storage statistics
   * @returns {Object} Fallback storage statistics
   */
  getStats () {
    return {
      memoryCacheSize: this.memoryCache.size,
      memoryKeys: Array.from(this.memoryCache.keys()),
      hasLocalStorageFallback: typeof localStorage !== 'undefined'
    }
  }
}

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterStorageCircuitBreaker = {
    StorageCircuitBreaker,
    StorageCircuitBreakerError,
    StorageFallbackManager
  }
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterStorageCircuitBreaker = {
    StorageCircuitBreaker,
    StorageCircuitBreakerError,
    StorageFallbackManager
  }
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterStorageCircuitBreaker = {
    StorageCircuitBreaker,
    StorageCircuitBreakerError,
    StorageFallbackManager
  }
}
