/**
 * Connection Tracker Module for WebRTC Stats Exporter
 * Handles peer connection lifecycle tracking, stale connection cleanup, and origin-based aggregation
 */

/**
 * ConnectionTracker class for managing WebRTC peer connection state
 */
class ConnectionTracker {
  constructor (storageManager, logger, config) {
    this.storageManager = storageManager
    this.logger = logger
    this.config = config
    this.cleanupCallback = null
  }

  /**
   * Set or remove a peer connection's last update timestamp
   * @param {Object} connection - Connection info
   * @param {string} connection.id - Unique connection ID
   * @param {string} connection.origin - Origin domain
   * @param {number} [lastUpdate=0] - Timestamp in ms, 0 to remove connection
   * @returns {Promise<void>}
   */
  async setPeerConnectionLastUpdate ({ id, origin }, lastUpdate = 0) {
    try {
      let { peerConnectionsLastUpdate } = await this.storageManager.getLocal('peerConnectionsLastUpdate')
      
      if (!peerConnectionsLastUpdate) {
        peerConnectionsLastUpdate = {}
      }

      if (lastUpdate) {
        peerConnectionsLastUpdate[id] = { origin, lastUpdate }
        this.logger?.log(`Connection updated: ${id} (${origin})`)
      } else {
        delete peerConnectionsLastUpdate[id]
        this.logger?.log(`Connection removed: ${id} (${origin})`)
      }

      // Update storage with connection tracking data
      await this.storageManager.setLocal({ peerConnectionsLastUpdate })

      // Calculate and update per-origin connection counts
      await this._updateConnectionCounts(peerConnectionsLastUpdate)
    } catch (error) {
      this.logger?.log(`Error updating peer connection: ${error.message}`)
      throw new ConnectionTrackerError(`Failed to update peer connection: ${error.message}`)
    }
  }

  /**
   * Get current connection statistics
   * @returns {Promise<Object>} Connection statistics
   */
  async getConnectionStats () {
    try {
      const { peerConnectionsLastUpdate, peerConnectionsPerOrigin } = await this.storageManager.getLocal([
        'peerConnectionsLastUpdate',
        'peerConnectionsPerOrigin'
      ])

      const totalConnections = Object.keys(peerConnectionsLastUpdate || {}).length
      const originCounts = peerConnectionsPerOrigin || {}

      return {
        totalConnections,
        originCounts,
        connections: peerConnectionsLastUpdate || {}
      }
    } catch (error) {
      this.logger?.log(`Error getting connection stats: ${error.message}`)
      return {
        totalConnections: 0,
        originCounts: {},
        connections: {}
      }
    }
  }

  /**
   * Get connections for a specific origin
   * @param {string} origin - Origin to filter by
   * @returns {Promise<Array>} Array of connection IDs for the origin
   */
  async getConnectionsByOrigin (origin) {
    try {
      const { peerConnectionsLastUpdate } = await this.storageManager.getLocal('peerConnectionsLastUpdate')
      
      if (!peerConnectionsLastUpdate) {
        return []
      }

      return Object.entries(peerConnectionsLastUpdate)
        .filter(([_, { origin: connOrigin }]) => connOrigin === origin)
        .map(([id]) => id)
    } catch (error) {
      this.logger?.log(`Error getting connections by origin: ${error.message}`)
      return []
    }
  }

  /**
   * Clean up stale peer connections based on update interval
   * @param {Object} options - Configuration options
   * @param {number} options.updateInterval - Update interval in seconds
   * @returns {Promise<Array>} Array of cleaned up connection info
   */
  async cleanupStaleConnections (options) {
    try {
      const { peerConnectionsLastUpdate } = await this.storageManager.getLocal('peerConnectionsLastUpdate')
      
      if (!peerConnectionsLastUpdate || !Object.keys(peerConnectionsLastUpdate).length) {
        this.logger?.log('No peer connections to clean up')
        return []
      }

      const connectionCount = Object.keys(peerConnectionsLastUpdate).length
      this.logger?.log(`Checking stale peer connections (${connectionCount} total)`)

      const now = Date.now()
      const staleThreshold = Math.max(2 * options.updateInterval, 30) * 1000
      
      const staleConnections = Object.entries(peerConnectionsLastUpdate)
        .map(([id, { origin, lastUpdate }]) => {
          if (now - lastUpdate > staleThreshold) {
            return { id, origin, lastUpdate, staleDuration: now - lastUpdate }
          }
          return null
        })
        .filter(Boolean)

      if (staleConnections.length === 0) {
        this.logger?.log('No stale connections found')
        return []
      }

      // Process cleanup through callback if provided
      const cleanupResults = []
      if (this.cleanupCallback) {
        for (const { id, origin, staleDuration } of staleConnections) {
          try {
            this.logger?.log(`Removing stale peer connection: ${id} ${origin} (stale for ${Math.round(staleDuration / 1000)}s)`)
            await this.cleanupCallback({ id, origin })
            cleanupResults.push({ id, origin, success: true })
          } catch (error) {
            this.logger?.log(`Error cleaning up connection ${id}: ${error.message}`)
            cleanupResults.push({ id, origin, success: false, error: error.message })
          }
        }
      }

      return cleanupResults
    } catch (error) {
      this.logger?.log(`Error during cleanup: ${error.message}`)
      throw new ConnectionTrackerError(`Cleanup failed: ${error.message}`)
    }
  }

  /**
   * Set callback function for cleaning up stale connections
   * @param {Function} callback - Async function that handles connection cleanup
   */
  setCleanupCallback (callback) {
    if (typeof callback !== 'function') {
      throw new Error('Cleanup callback must be a function')
    }
    this.cleanupCallback = callback
  }

  /**
   * Remove all connections for a specific origin
   * @param {string} origin - Origin to clear
   * @returns {Promise<number>} Number of connections removed
   */
  async clearConnectionsByOrigin (origin) {
    try {
      const { peerConnectionsLastUpdate } = await this.storageManager.getLocal('peerConnectionsLastUpdate')
      
      if (!peerConnectionsLastUpdate) {
        return 0
      }

      const connectionsToRemove = Object.entries(peerConnectionsLastUpdate)
        .filter(([_, { origin: connOrigin }]) => connOrigin === origin)

      if (connectionsToRemove.length === 0) {
        return 0
      }

      // Remove connections
      for (const [id] of connectionsToRemove) {
        delete peerConnectionsLastUpdate[id]
      }

      await this.storageManager.setLocal({ peerConnectionsLastUpdate })
      await this._updateConnectionCounts(peerConnectionsLastUpdate)

      this.logger?.log(`Cleared ${connectionsToRemove.length} connections for origin: ${origin}`)
      return connectionsToRemove.length
    } catch (error) {
      this.logger?.log(`Error clearing connections by origin: ${error.message}`)
      throw new ConnectionTrackerError(`Failed to clear connections: ${error.message}`)
    }
  }

  /**
   * Clear all connections (useful for testing or reset)
   * @returns {Promise<number>} Number of connections removed
   */
  async clearAllConnections () {
    try {
      const { peerConnectionsLastUpdate } = await this.storageManager.getLocal('peerConnectionsLastUpdate')
      const connectionCount = Object.keys(peerConnectionsLastUpdate || {}).length

      await this.storageManager.setLocal({ 
        peerConnectionsLastUpdate: {},
        peerConnectionsPerOrigin: {}
      })

      this.logger?.log(`Cleared all ${connectionCount} peer connections`)
      return connectionCount
    } catch (error) {
      this.logger?.log(`Error clearing all connections: ${error.message}`)
      throw new ConnectionTrackerError(`Failed to clear all connections: ${error.message}`)
    }
  }

  /**
   * Get health status of connection tracking
   * @returns {Promise<Object>} Health status information
   */
  async getHealthStatus () {
    try {
      const stats = await this.getConnectionStats()
      const now = Date.now()
      
      // Check for very old connections that might indicate issues
      const oldConnections = Object.entries(stats.connections)
        .filter(([_, { lastUpdate }]) => now - lastUpdate > 300000) // 5 minutes
      
      const healthStatus = {
        isHealthy: oldConnections.length === 0,
        totalConnections: stats.totalConnections,
        oldConnectionCount: oldConnections.length,
        oldestConnection: oldConnections.length > 0 
          ? Math.max(...oldConnections.map(([_, { lastUpdate }]) => now - lastUpdate))
          : 0,
        originCounts: stats.originCounts
      }

      // Add storage health information if available
      if (this.storageManager && typeof this.storageManager.getHealthStats === 'function') {
        healthStatus.storageHealth = this.storageManager.getHealthStats()
      }

      return healthStatus
    } catch (error) {
      return {
        isHealthy: false,
        error: error.message,
        totalConnections: 0,
        oldConnectionCount: 0,
        oldestConnection: 0,
        originCounts: {}
      }
    }
  }

  // Private methods

  /**
   * Update per-origin connection counts
   * @private
   */
  async _updateConnectionCounts (peerConnectionsLastUpdate) {
    const peerConnectionsPerOrigin = {}
    
    Object.values(peerConnectionsLastUpdate).forEach(({ origin }) => {
      if (!peerConnectionsPerOrigin[origin]) {
        peerConnectionsPerOrigin[origin] = 0
      }
      peerConnectionsPerOrigin[origin]++
    })

    await this.storageManager.setLocal({ peerConnectionsPerOrigin })
  }
}

/**
 * Custom error class for connection tracking errors
 */
class ConnectionTrackerError extends Error {
  constructor (message) {
    super(message)
    this.name = 'ConnectionTrackerError'
  }
}

/**
 * Create a pre-configured ConnectionTracker instance
 * @param {Object} dependencies - Required dependencies
 * @param {Object} dependencies.storageManager - Storage manager instance
 * @param {Object} dependencies.logger - Logger instance (optional)
 * @param {Object} dependencies.config - Config module reference (optional)
 * @returns {ConnectionTracker} Configured connection tracker
 */
function createConnectionTracker ({ storageManager, logger, config }) {
  return new ConnectionTracker(storageManager, logger, config)
}

/**
 * Create connection tracker with automatic cleanup setup
 * @param {Object} dependencies - Required dependencies
 * @param {Function} cleanupCallback - Function to call for connection cleanup
 * @returns {ConnectionTracker} Configured connection tracker with cleanup
 */
function createConnectionTrackerWithCleanup (dependencies, cleanupCallback) {
  const tracker = createConnectionTracker(dependencies)
  tracker.setCleanupCallback(cleanupCallback)
  return tracker
}

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterConnectionTracker = {
    ConnectionTracker,
    ConnectionTrackerError,
    createConnectionTracker,
    createConnectionTrackerWithCleanup
  }
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterConnectionTracker = {
    ConnectionTracker,
    ConnectionTrackerError,
    createConnectionTracker,
    createConnectionTrackerWithCleanup
  }
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterConnectionTracker = {
    ConnectionTracker,
    ConnectionTrackerError,
    createConnectionTracker,
    createConnectionTrackerWithCleanup
  }
}
