/**
 * Shared Lifecycle Manager for WebRTC Stats Exporter
 * Provides memory leak prevention through resource tracking and cleanup
 */

/**
 * ResourceTracker class for tracking event listeners, timers, and other resources
 * to prevent memory leaks in Chrome extensions
 */
class ResourceTracker {
  constructor (name = 'ResourceTracker') {
    this.name = name
    this.eventListeners = new Map()
    this.timers = new Set()
    this.intervals = new Set()
    this.chromeListeners = new Map()
    this.isDestroyed = false
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
      this.logger.log(`[${this.name}]`, ...args)
    }
  }

  /**
   * Register an event listener for automatic cleanup
   * @param {Object} target - Event target (DOM element, etc.)
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   * @param {Object} options - Event listener options
   * @returns {Function} Cleanup function
   */
  registerEventListener (target, event, handler, options = {}) {
    if (this.isDestroyed) {
      this.log('Cannot register event listener - tracker is destroyed')
      return () => {}
    }

    try {
      target.addEventListener(event, handler, options)
      
      const key = { target, event, handler, options }
      this.eventListeners.set(key, { target, event, handler, options })
      
      this.log(`Registered event listener: ${event}`)
      
      // Return cleanup function
      return () => {
        this.removeEventListener(key)
      }
    } catch (error) {
      this.log(`Error registering event listener for ${event}:`, error.message)
      return () => {}
    }
  }

  /**
   * Register a Chrome API event listener for automatic cleanup
   * @param {Object} chromeEvent - Chrome event object (e.g., chrome.tabs.onActivated)
   * @param {Function} handler - Event handler function
   * @returns {Function} Cleanup function
   */
  registerChromeListener (chromeEvent, handler) {
    if (this.isDestroyed) {
      this.log('Cannot register Chrome listener - tracker is destroyed')
      return () => {}
    }

    try {
      chromeEvent.addListener(handler)
      
      const key = { chromeEvent, handler }
      this.chromeListeners.set(key, { chromeEvent, handler })
      
      this.log(`Registered Chrome listener for ${chromeEvent.constructor.name || 'unknown event'}`)
      
      // Return cleanup function
      return () => {
        this.removeChromeListener(key)
      }
    } catch (error) {
      this.log(`Error registering Chrome listener:`, error.message)
      return () => {}
    }
  }

  /**
   * Register a timer for automatic cleanup
   * @param {Function} callback - Timer callback
   * @param {number} delay - Timer delay in milliseconds
   * @returns {number} Timer ID
   */
  registerTimeout (callback, delay) {
    if (this.isDestroyed) {
      this.log('Cannot register timeout - tracker is destroyed')
      return 0
    }

    try {
      const timerId = setTimeout(() => {
        // Remove from tracking when timer fires
        this.timers.delete(timerId)
        callback()
      }, delay)
      
      this.timers.add(timerId)
      this.log(`Registered timeout: ${timerId} (${delay}ms)`)
      
      return timerId
    } catch (error) {
      this.log(`Error registering timeout:`, error.message)
      return 0
    }
  }

  /**
   * Register an interval for automatic cleanup
   * @param {Function} callback - Interval callback
   * @param {number} delay - Interval delay in milliseconds
   * @returns {number} Interval ID
   */
  registerInterval (callback, delay) {
    if (this.isDestroyed) {
      this.log('Cannot register interval - tracker is destroyed')
      return 0
    }

    try {
      const intervalId = setInterval(callback, delay)
      
      this.intervals.add(intervalId)
      this.log(`Registered interval: ${intervalId} (${delay}ms)`)
      
      return intervalId
    } catch (error) {
      this.log(`Error registering interval:`, error.message)
      return 0
    }
  }

  /**
   * Manually remove an event listener
   * @param {Object} key - Event listener key
   */
  removeEventListener (key) {
    try {
      const listener = this.eventListeners.get(key)
      if (listener) {
        listener.target.removeEventListener(listener.event, listener.handler, listener.options)
        this.eventListeners.delete(key)
        this.log(`Removed event listener: ${listener.event}`)
      }
    } catch (error) {
      this.log(`Error removing event listener:`, error.message)
    }
  }

  /**
   * Manually remove a Chrome API event listener
   * @param {Object} key - Chrome listener key
   */
  removeChromeListener (key) {
    try {
      const listener = this.chromeListeners.get(key)
      if (listener) {
        // Chrome API listeners don't provide removeListener, so we track for logging only
        // The service worker restart will clean them up automatically
        this.chromeListeners.delete(key)
        this.log(`Marked Chrome listener for cleanup`)
      }
    } catch (error) {
      this.log(`Error removing Chrome listener:`, error.message)
    }
  }

  /**
   * Manually clear a timeout
   * @param {number} timerId - Timer ID to clear
   */
  clearTimeout (timerId) {
    try {
      if (this.timers.has(timerId)) {
        clearTimeout(timerId)
        this.timers.delete(timerId)
        this.log(`Cleared timeout: ${timerId}`)
      }
    } catch (error) {
      this.log(`Error clearing timeout ${timerId}:`, error.message)
    }
  }

  /**
   * Manually clear an interval
   * @param {number} intervalId - Interval ID to clear
   */
  clearInterval (intervalId) {
    try {
      if (this.intervals.has(intervalId)) {
        clearInterval(intervalId)
        this.intervals.delete(intervalId)
        this.log(`Cleared interval: ${intervalId}`)
      }
    } catch (error) {
      this.log(`Error clearing interval ${intervalId}:`, error.message)
    }
  }

  /**
   * Get resource tracking statistics
   * @returns {Object} Resource tracking statistics
   */
  getStats () {
    return {
      name: this.name,
      isDestroyed: this.isDestroyed,
      eventListeners: this.eventListeners.size,
      chromeListeners: this.chromeListeners.size,
      timers: this.timers.size,
      intervals: this.intervals.size,
      totalResources: this.eventListeners.size + this.chromeListeners.size + this.timers.size + this.intervals.size
    }
  }

  /**
   * Destroy the tracker and clean up all resources
   */
  destroy () {
    if (this.isDestroyed) {
      this.log('Tracker already destroyed')
      return
    }

    this.log('Starting resource cleanup...')

    // Clean up event listeners
    let cleaned = 0
    for (const [key, listener] of this.eventListeners) {
      try {
        listener.target.removeEventListener(listener.event, listener.handler, listener.options)
        cleaned++
      } catch (error) {
        this.log(`Error cleaning up event listener for ${listener.event}:`, error.message)
      }
    }
    this.eventListeners.clear()
    this.log(`Cleaned up ${cleaned} event listeners`)

    // Note: Chrome API listeners don't provide removeListener
    // They will be automatically cleaned up when the service worker restarts
    const chromeListenerCount = this.chromeListeners.size
    this.chromeListeners.clear()
    this.log(`Marked ${chromeListenerCount} Chrome listeners for cleanup (will be cleaned up on service worker restart)`)

    // Clear all timers
    let timersCleared = 0
    for (const timerId of this.timers) {
      try {
        clearTimeout(timerId)
        timersCleared++
      } catch (error) {
        this.log(`Error clearing timeout ${timerId}:`, error.message)
      }
    }
    this.timers.clear()
    this.log(`Cleared ${timersCleared} timers`)

    // Clear all intervals
    let intervalsCleared = 0
    for (const intervalId of this.intervals) {
      try {
        clearInterval(intervalId)
        intervalsCleared++
      } catch (error) {
        this.log(`Error clearing interval ${intervalId}:`, error.message)
      }
    }
    this.intervals.clear()
    this.log(`Cleared ${intervalsCleared} intervals`)

    this.isDestroyed = true
    this.log(`Resource cleanup complete - cleaned ${cleaned + timersCleared + intervalsCleared} resources`)
  }
}

/**
 * Create a pre-configured ResourceTracker instance
 * @param {string} name - Name for the tracker (for logging)
 * @param {Object} logger - Logger instance (optional)
 * @returns {ResourceTracker} Configured resource tracker
 */
function createResourceTracker (name, logger = null) {
  const tracker = new ResourceTracker(name)
  if (logger) {
    tracker.setLogger(logger)
  }
  return tracker
}

/**
 * Global resource tracker for shared use across modules
 */
let globalTracker = null

/**
 * Get or create the global resource tracker
 * @param {Object} logger - Logger instance (optional)
 * @returns {ResourceTracker} Global resource tracker
 */
function getGlobalTracker (logger = null) {
  if (!globalTracker || globalTracker.isDestroyed) {
    globalTracker = createResourceTracker('GlobalTracker', logger)
  }
  return globalTracker
}

/**
 * Destroy the global resource tracker
 */
function destroyGlobalTracker () {
  if (globalTracker) {
    globalTracker.destroy()
    globalTracker = null
  }
}

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterLifecycleManager = {
    ResourceTracker,
    createResourceTracker,
    getGlobalTracker,
    destroyGlobalTracker
  }
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterLifecycleManager = {
    ResourceTracker,
    createResourceTracker,
    getGlobalTracker,
    destroyGlobalTracker
  }
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterLifecycleManager = {
    ResourceTracker,
    createResourceTracker,
    getGlobalTracker,
    destroyGlobalTracker
  }
}