/**
 * Unit tests for ConnectionTracker module
 */

const fs = require('fs')
const path = require('path')

describe('ConnectionTracker', () => {
  let ConnectionTracker, ConnectionTrackerError, createConnectionTracker, createConnectionTrackerWithCleanup
  let mockStorageManager, mockLogger, mockConfig
  let tracker

  beforeAll(() => {
    // Load the connection tracker module directly
    const modulePath = path.join(__dirname, '../../background/connection-tracker.js')
    const moduleCode = fs.readFileSync(modulePath, 'utf8')
    
    // Execute the module code
    const moduleFunction = new Function('global', 'globalThis', 'self', 'window', 'console', moduleCode)
    moduleFunction(global, global, global, global, console)
    
    // Get the exported classes
    const exports = global.WebRTCExporterConnectionTracker
    ConnectionTracker = exports.ConnectionTracker
    ConnectionTrackerError = exports.ConnectionTrackerError
    createConnectionTracker = exports.createConnectionTracker
    createConnectionTrackerWithCleanup = exports.createConnectionTrackerWithCleanup
  })

  beforeEach(() => {
    // Mock storage manager
    mockStorageManager = {
      getLocal: jest.fn(),
      setLocal: jest.fn()
    }

    // Mock logger
    mockLogger = {
      log: jest.fn()
    }

    // Mock config
    mockConfig = {
      CONSTANTS: {
        UPDATE_INTERVALS: {
          CLEANUP_THRESHOLD: 30
        }
      }
    }

    tracker = new ConnectionTracker(mockStorageManager, mockLogger, mockConfig)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('constructor', () => {
    test('should initialize with dependencies', () => {
      expect(tracker.storageManager).toBe(mockStorageManager)
      expect(tracker.logger).toBe(mockLogger)
      expect(tracker.config).toBe(mockConfig)
      expect(tracker.cleanupCallback).toBeNull()
    })
  })

  describe('setPeerConnectionLastUpdate', () => {
    test('should add new connection', async () => {
      const connection = { id: 'conn-1', origin: 'https://teams.microsoft.com' }
      const timestamp = Date.now()

      mockStorageManager.getLocal.mockResolvedValue({})
      mockStorageManager.setLocal.mockResolvedValue()

      await tracker.setPeerConnectionLastUpdate(connection, timestamp)

      expect(mockStorageManager.getLocal).toHaveBeenCalledWith('peerConnectionsLastUpdate')
      expect(mockStorageManager.setLocal).toHaveBeenCalledWith({
        peerConnectionsLastUpdate: {
          'conn-1': { origin: 'https://teams.microsoft.com', lastUpdate: timestamp }
        }
      })
      expect(mockStorageManager.setLocal).toHaveBeenCalledWith({
        peerConnectionsPerOrigin: {
          'https://teams.microsoft.com': 1
        }
      })
      expect(mockLogger.log).toHaveBeenCalledWith('Connection updated: conn-1 (https://teams.microsoft.com)')
    })

    test('should update existing connection', async () => {
      const connection = { id: 'conn-1', origin: 'https://teams.microsoft.com' }
      const newTimestamp = Date.now()

      mockStorageManager.getLocal.mockResolvedValue({
        peerConnectionsLastUpdate: {
          'conn-1': { origin: 'https://teams.microsoft.com', lastUpdate: Date.now() - 1000 },
          'conn-2': { origin: 'https://meet.google.com', lastUpdate: Date.now() - 500 }
        }
      })
      mockStorageManager.setLocal.mockResolvedValue()

      await tracker.setPeerConnectionLastUpdate(connection, newTimestamp)

      expect(mockStorageManager.setLocal).toHaveBeenCalledWith(
        expect.objectContaining({
          peerConnectionsLastUpdate: expect.objectContaining({
            'conn-1': { origin: 'https://teams.microsoft.com', lastUpdate: newTimestamp },
            'conn-2': { origin: 'https://meet.google.com', lastUpdate: expect.any(Number) }
          })
        })
      )
    })

    test('should remove connection when lastUpdate is 0', async () => {
      const connection = { id: 'conn-1', origin: 'https://teams.microsoft.com' }

      mockStorageManager.getLocal.mockResolvedValue({
        peerConnectionsLastUpdate: {
          'conn-1': { origin: 'https://teams.microsoft.com', lastUpdate: Date.now() },
          'conn-2': { origin: 'https://meet.google.com', lastUpdate: Date.now() }
        }
      })
      mockStorageManager.setLocal.mockResolvedValue()

      await tracker.setPeerConnectionLastUpdate(connection, 0)

      expect(mockStorageManager.setLocal).toHaveBeenCalledWith(
        expect.objectContaining({
          peerConnectionsLastUpdate: expect.objectContaining({
            'conn-2': { origin: 'https://meet.google.com', lastUpdate: expect.any(Number) }
          })
        })
      )
      expect(mockStorageManager.setLocal).toHaveBeenCalledWith({
        peerConnectionsPerOrigin: {
          'https://meet.google.com': 1
        }
      })
      expect(mockLogger.log).toHaveBeenCalledWith('Connection removed: conn-1 (https://teams.microsoft.com)')
    })

    test('should handle storage errors gracefully', async () => {
      const connection = { id: 'conn-1', origin: 'https://teams.microsoft.com' }
      const storageError = new Error('Storage failed')

      mockStorageManager.getLocal.mockRejectedValue(storageError)

      await expect(tracker.setPeerConnectionLastUpdate(connection, Date.now()))
        .rejects.toThrow(ConnectionTrackerError)
      
      expect(mockLogger.log).toHaveBeenCalledWith('Error updating peer connection: Storage failed')
    })

    test('should handle missing storage data', async () => {
      const connection = { id: 'conn-1', origin: 'https://teams.microsoft.com' }
      
      mockStorageManager.getLocal.mockResolvedValue({ peerConnectionsLastUpdate: null })
      mockStorageManager.setLocal.mockResolvedValue()

      await tracker.setPeerConnectionLastUpdate(connection, Date.now())

      expect(mockStorageManager.setLocal).toHaveBeenCalledWith(
        expect.objectContaining({
          peerConnectionsLastUpdate: expect.objectContaining({
            'conn-1': expect.any(Object)
          })
        })
      )
    })
  })

  describe('getConnectionStats', () => {
    test('should return connection statistics', async () => {
      const mockData = {
        peerConnectionsLastUpdate: {
          'conn-1': { origin: 'https://teams.microsoft.com', lastUpdate: Date.now() },
          'conn-2': { origin: 'https://meet.google.com', lastUpdate: Date.now() }
        },
        peerConnectionsPerOrigin: {
          'https://teams.microsoft.com': 1,
          'https://meet.google.com': 1
        }
      }

      mockStorageManager.getLocal.mockResolvedValue(mockData)

      const stats = await tracker.getConnectionStats()

      expect(stats).toEqual({
        totalConnections: 2,
        originCounts: mockData.peerConnectionsPerOrigin,
        connections: mockData.peerConnectionsLastUpdate
      })
    })

    test('should handle missing data gracefully', async () => {
      mockStorageManager.getLocal.mockResolvedValue({})

      const stats = await tracker.getConnectionStats()

      expect(stats).toEqual({
        totalConnections: 0,
        originCounts: {},
        connections: {}
      })
    })

    test('should handle storage errors', async () => {
      mockStorageManager.getLocal.mockRejectedValue(new Error('Storage error'))

      const stats = await tracker.getConnectionStats()

      expect(stats).toEqual({
        totalConnections: 0,
        originCounts: {},
        connections: {}
      })
      expect(mockLogger.log).toHaveBeenCalledWith('Error getting connection stats: Storage error')
    })
  })

  describe('getConnectionsByOrigin', () => {
    test('should return connections for specific origin', async () => {
      mockStorageManager.getLocal.mockResolvedValue({
        peerConnectionsLastUpdate: {
          'conn-1': { origin: 'https://teams.microsoft.com', lastUpdate: Date.now() },
          'conn-2': { origin: 'https://meet.google.com', lastUpdate: Date.now() },
          'conn-3': { origin: 'https://teams.microsoft.com', lastUpdate: Date.now() }
        }
      })

      const connections = await tracker.getConnectionsByOrigin('https://teams.microsoft.com')

      expect(connections).toEqual(['conn-1', 'conn-3'])
    })

    test('should return empty array for unknown origin', async () => {
      mockStorageManager.getLocal.mockResolvedValue({
        peerConnectionsLastUpdate: {
          'conn-1': { origin: 'https://teams.microsoft.com', lastUpdate: Date.now() }
        }
      })

      const connections = await tracker.getConnectionsByOrigin('https://unknown.com')

      expect(connections).toEqual([])
    })

    test('should handle missing storage data', async () => {
      mockStorageManager.getLocal.mockResolvedValue({})

      const connections = await tracker.getConnectionsByOrigin('https://teams.microsoft.com')

      expect(connections).toEqual([])
    })
  })

  describe('cleanupStaleConnections', () => {
    test('should identify and cleanup stale connections', async () => {
      const now = Date.now()
      const staleTimestamp = now - 120000 // 2 minutes old
      const freshTimestamp = now - 30000 // 30 seconds old

      mockStorageManager.getLocal.mockResolvedValue({
        peerConnectionsLastUpdate: {
          'stale-conn': { origin: 'https://teams.microsoft.com', lastUpdate: staleTimestamp },
          'fresh-conn': { origin: 'https://meet.google.com', lastUpdate: freshTimestamp }
        }
      })

      const mockCleanupCallback = jest.fn().mockResolvedValue()
      tracker.setCleanupCallback(mockCleanupCallback)

      const options = { updateInterval: 30 } // 30 seconds
      const results = await tracker.cleanupStaleConnections(options)

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({
        id: 'stale-conn',
        origin: 'https://teams.microsoft.com',
        success: true
      })
      expect(mockCleanupCallback).toHaveBeenCalledWith({
        id: 'stale-conn',
        origin: 'https://teams.microsoft.com'
      })
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Removing stale peer connection: stale-conn https://teams.microsoft.com')
      )
    })

    test('should handle cleanup callback errors', async () => {
      const now = Date.now()
      const staleTimestamp = now - 120000

      mockStorageManager.getLocal.mockResolvedValue({
        peerConnectionsLastUpdate: {
          'stale-conn': { origin: 'https://teams.microsoft.com', lastUpdate: staleTimestamp }
        }
      })

      const mockCleanupCallback = jest.fn().mockRejectedValue(new Error('Cleanup failed'))
      tracker.setCleanupCallback(mockCleanupCallback)

      const options = { updateInterval: 30 }
      const results = await tracker.cleanupStaleConnections(options)

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({
        id: 'stale-conn',
        origin: 'https://teams.microsoft.com',
        success: false,
        error: 'Cleanup failed'
      })
    })

    test('should return empty array when no stale connections', async () => {
      const now = Date.now()
      
      mockStorageManager.getLocal.mockResolvedValue({
        peerConnectionsLastUpdate: {
          'fresh-conn': { origin: 'https://teams.microsoft.com', lastUpdate: now - 10000 }
        }
      })

      const options = { updateInterval: 30 }
      const results = await tracker.cleanupStaleConnections(options)

      expect(results).toEqual([])
      expect(mockLogger.log).toHaveBeenCalledWith('No stale connections found')
    })

    test('should return early when no connections exist', async () => {
      mockStorageManager.getLocal.mockResolvedValue({})

      const options = { updateInterval: 30 }
      const results = await tracker.cleanupStaleConnections(options)

      expect(results).toEqual([])
      expect(mockLogger.log).toHaveBeenCalledWith('No peer connections to clean up')
    })

    test('should use minimum threshold of 30 seconds', async () => {
      const now = Date.now()
      const timestamp = now - 25000 // 25 seconds old

      mockStorageManager.getLocal.mockResolvedValue({
        peerConnectionsLastUpdate: {
          'conn-1': { origin: 'https://teams.microsoft.com', lastUpdate: timestamp }
        }
      })

      const options = { updateInterval: 5 } // 5 seconds (below minimum)
      const results = await tracker.cleanupStaleConnections(options)

      // Should not be considered stale because 25s < 30s minimum threshold
      expect(results).toEqual([])
    })
  })

  describe('setCleanupCallback', () => {
    test('should set cleanup callback function', () => {
      const mockCallback = jest.fn()
      
      tracker.setCleanupCallback(mockCallback)
      
      expect(tracker.cleanupCallback).toBe(mockCallback)
    })

    test('should throw error for non-function callback', () => {
      expect(() => tracker.setCleanupCallback('not a function'))
        .toThrow('Cleanup callback must be a function')
    })
  })

  describe('clearConnectionsByOrigin', () => {
    test('should clear connections for specific origin', async () => {
      mockStorageManager.getLocal.mockResolvedValue({
        peerConnectionsLastUpdate: {
          'conn-1': { origin: 'https://teams.microsoft.com', lastUpdate: Date.now() },
          'conn-2': { origin: 'https://meet.google.com', lastUpdate: Date.now() },
          'conn-3': { origin: 'https://teams.microsoft.com', lastUpdate: Date.now() }
        }
      })
      mockStorageManager.setLocal.mockResolvedValue()

      const cleared = await tracker.clearConnectionsByOrigin('https://teams.microsoft.com')

      expect(cleared).toBe(2)
      expect(mockStorageManager.setLocal).toHaveBeenCalledWith(
        expect.objectContaining({
          peerConnectionsLastUpdate: expect.objectContaining({
            'conn-2': { origin: 'https://meet.google.com', lastUpdate: expect.any(Number) }
          })
        })
      )
      expect(mockLogger.log).toHaveBeenCalledWith('Cleared 2 connections for origin: https://teams.microsoft.com')
    })

    test('should return 0 when no connections for origin', async () => {
      mockStorageManager.getLocal.mockResolvedValue({
        peerConnectionsLastUpdate: {
          'conn-1': { origin: 'https://meet.google.com', lastUpdate: Date.now() }
        }
      })

      const cleared = await tracker.clearConnectionsByOrigin('https://teams.microsoft.com')

      expect(cleared).toBe(0)
    })
  })

  describe('clearAllConnections', () => {
    test('should clear all connections', async () => {
      mockStorageManager.getLocal.mockResolvedValue({
        peerConnectionsLastUpdate: {
          'conn-1': { origin: 'https://teams.microsoft.com', lastUpdate: Date.now() },
          'conn-2': { origin: 'https://meet.google.com', lastUpdate: Date.now() }
        }
      })
      mockStorageManager.setLocal.mockResolvedValue()

      const cleared = await tracker.clearAllConnections()

      expect(cleared).toBe(2)
      expect(mockStorageManager.setLocal).toHaveBeenCalledWith({
        peerConnectionsLastUpdate: {},
        peerConnectionsPerOrigin: {}
      })
      expect(mockLogger.log).toHaveBeenCalledWith('Cleared all 2 peer connections')
    })
  })

  describe('getHealthStatus', () => {
    test('should return healthy status for recent connections', async () => {
      const now = Date.now()
      
      mockStorageManager.getLocal.mockResolvedValue({
        peerConnectionsLastUpdate: {
          'conn-1': { origin: 'https://teams.microsoft.com', lastUpdate: now - 60000 }
        },
        peerConnectionsPerOrigin: {
          'https://teams.microsoft.com': 1
        }
      })

      const health = await tracker.getHealthStatus()

      expect(health.isHealthy).toBe(true)
      expect(health.totalConnections).toBe(1)
      expect(health.oldConnectionCount).toBe(0)
    })

    test('should return unhealthy status for old connections', async () => {
      const now = Date.now()
      const oldTimestamp = now - 400000 // 6+ minutes old

      mockStorageManager.getLocal.mockResolvedValue({
        peerConnectionsLastUpdate: {
          'old-conn': { origin: 'https://teams.microsoft.com', lastUpdate: oldTimestamp }
        },
        peerConnectionsPerOrigin: {
          'https://teams.microsoft.com': 1
        }
      })

      const health = await tracker.getHealthStatus()

      expect(health.isHealthy).toBe(false)
      expect(health.oldConnectionCount).toBe(1)
      expect(health.oldestConnection).toBeGreaterThan(300000)
    })

    test('should handle errors gracefully', async () => {
      // Mock getConnectionStats to fail directly
      const originalGetConnectionStats = tracker.getConnectionStats
      tracker.getConnectionStats = jest.fn().mockRejectedValue(new Error('Storage error'))

      const health = await tracker.getHealthStatus()

      expect(health.isHealthy).toBe(false)
      expect(health.error).toBe('Storage error')
      
      // Restore original method
      tracker.getConnectionStats = originalGetConnectionStats
    })
  })

  describe('ConnectionTrackerError', () => {
    test('should create custom error', () => {
      const error = new ConnectionTrackerError('Test error message')
      
      expect(error.name).toBe('ConnectionTrackerError')
      expect(error.message).toBe('Test error message')
      expect(error instanceof Error).toBe(true)
    })
  })

  describe('createConnectionTracker', () => {
    test('should create tracker with dependencies', () => {
      const tracker = createConnectionTracker({
        storageManager: mockStorageManager,
        logger: mockLogger,
        config: mockConfig
      })

      expect(tracker).toBeInstanceOf(ConnectionTracker)
      expect(tracker.storageManager).toBe(mockStorageManager)
      expect(tracker.logger).toBe(mockLogger)
      expect(tracker.config).toBe(mockConfig)
    })
  })

  describe('createConnectionTrackerWithCleanup', () => {
    test('should create tracker with cleanup callback', () => {
      const mockCallback = jest.fn()
      
      const tracker = createConnectionTrackerWithCleanup({
        storageManager: mockStorageManager,
        logger: mockLogger,
        config: mockConfig
      }, mockCallback)

      expect(tracker).toBeInstanceOf(ConnectionTracker)
      expect(tracker.cleanupCallback).toBe(mockCallback)
    })
  })
})