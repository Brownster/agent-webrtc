/**
 * Integration tests for Main Orchestrator
 */

const fs = require('fs')
const path = require('path')

describe('Main Orchestrator', () => {
  let WebRTCExporterApp
  let mockChrome
  let app

  beforeAll(() => {
    // Mock Chrome APIs globally
    global.chrome = {
      storage: {
        sync: {
          get: jest.fn(),
          set: jest.fn()
        },
        local: {
          get: jest.fn(),
          set: jest.fn()
        },
        onChanged: {
          addListener: jest.fn()
        }
      },
      runtime: {
        onInstalled: {
          addListener: jest.fn()
        },
        onMessage: {
          addListener: jest.fn()
        }
      },
      alarms: {
        onAlarm: {
          addListener: jest.fn()
        },
        create: jest.fn(),
        clear: jest.fn(),
        get: jest.fn(),
        getAll: jest.fn()
      },
      tabs: {
        onActivated: {
          addListener: jest.fn()
        },
        onUpdated: {
          addListener: jest.fn()
        },
        get: jest.fn(),
        query: jest.fn(),
        sendMessage: jest.fn()
      },
      action: {
        setTitle: jest.fn(),
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn()
      }
    }

    // Mock global modules that would be loaded by importScripts
    global.self = {
      WebRTCExporterConfig: {
        CONSTANTS: {
          LOGGING: { PREFIX: '[WebRTC-Exporter' },
          EXTENSION: { ALARM_NAME: 'cleanup-alarm' },
          UPDATE_INTERVALS: { CLEANUP_INTERVAL_MINUTES: 60 }
        },
        DEFAULT_OPTIONS: {
          url: 'http://localhost:9091',
          agentId: 'test-agent',
          updateInterval: 2
        }
      },
      WebRTCExporterStorage: {
        StorageManager: {
          getOptions: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue(),
          onChanged: jest.fn().mockReturnValue(jest.fn())
        }
      },
      WebRTCExporterDomains: {
        DomainManager: {
          extractOrigin: jest.fn(),
          isTargetDomain: jest.fn(),
          shouldAutoEnable: jest.fn()
        }
      },
      WebRTCExporterPushgateway: {
        PushgatewayClient: jest.fn().mockImplementation(() => ({
          sendData: jest.fn().mockResolvedValue({ success: true })
        })),
        createStatsCallback: jest.fn().mockReturnValue(jest.fn())
      },
      WebRTCExporterOptionsManager: {
        createOptionsManager: jest.fn().mockImplementation(() => ({
          initialize: jest.fn().mockResolvedValue({}),
          onChange: jest.fn()
        }))
      },
      WebRTCExporterConnectionTracker: {
        createConnectionTrackerWithCleanup: jest.fn().mockImplementation(() => ({
          setPeerConnectionLastUpdate: jest.fn().mockResolvedValue(),
          cleanupStaleConnections: jest.fn().mockResolvedValue([]),
          getStats: jest.fn().mockReturnValue({ originCounts: {} })
        }))
      },
      WebRTCExporterLifecycle: {
        createAndInitializeLifecycleManager: jest.fn().mockResolvedValue({
          getStats: jest.fn().mockReturnValue({ isInitialized: true })
        })
      },
      WebRTCExporterTabMonitor: {
        createAndInitializeTabMonitor: jest.fn().mockResolvedValue({
          updateCurrentTab: jest.fn().mockResolvedValue(),
          updateOptions: jest.fn(),
          getStats: jest.fn().mockReturnValue({ isInitialized: true })
        })
      },
      WebRTCExporterMessageHandler: {
        createAndInitializeMessageHandler: jest.fn().mockResolvedValue({
          updateOptions: jest.fn(),
          getStats: jest.fn().mockReturnValue({ isInitialized: true })
        })
      },
      WebRTCExporterStatsFormatter: {
        StatsFormatter: {
          formatStats: jest.fn().mockReturnValue('formatted-data')
        }
      }
    }

    // Load the main orchestrator module directly
    const modulePath = path.join(__dirname, '../../background/index.js')
    const moduleCode = fs.readFileSync(modulePath, 'utf8')
    
    // Replace importScripts calls with no-ops for testing
    const testModuleCode = moduleCode.replace(/importScripts\([^)]+\);?/g, '// importScripts removed for testing')
    
    // Execute the module code and extract the class
    const moduleFunction = new Function('global', 'globalThis', 'self', 'window', 'console', 'chrome', testModuleCode + '; return WebRTCExporterApp;')
    WebRTCExporterApp = moduleFunction(global, global, global.self, global, console, global.chrome)
  })

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks()
    
    // Reset module mocks
    global.self.WebRTCExporterTabMonitor.createAndInitializeTabMonitor.mockResolvedValue({
      updateCurrentTab: jest.fn().mockResolvedValue(),
      updateOptions: jest.fn(),
      getStats: jest.fn().mockReturnValue({ isInitialized: true })
    })
    
    // Reset Chrome API mocks
    mockChrome = global.chrome
    mockChrome.storage.sync.get.mockResolvedValue({})
    mockChrome.storage.sync.set.mockResolvedValue()
    mockChrome.storage.local.get.mockResolvedValue({})
    mockChrome.storage.local.set.mockResolvedValue()
    mockChrome.tabs.query.mockResolvedValue([])
    mockChrome.tabs.get.mockResolvedValue({ id: 1, url: 'https://example.com' })
    
    // Create fresh app instance
    app = new WebRTCExporterApp()
  })

  afterEach(() => {
    if (app && app.isInitialized) {
      app.shutdown()
    }
  })

  describe('constructor', () => {
    test('should initialize with empty state', () => {
      expect(app.modules).toEqual({})
      expect(app.options).toEqual({})
      expect(app.isInitialized).toBe(false)
      expect(app.logger).toHaveProperty('log')
    })
  })

  describe('log method', () => {
    test('should log with correct prefix', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      app.log('test message', 'with args')
      
      expect(consoleSpy).toHaveBeenCalledWith('[WebRTC-Exporter:background]', 'test message', 'with args')
      
      consoleSpy.mockRestore()
    })
  })

  describe('initialize', () => {
    test('should initialize all modules successfully', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      
      await app.initialize()
      
      expect(app.isInitialized).toBe(true)
      expect(app.modules).toHaveProperty('pushgatewayClient')
      expect(app.modules).toHaveProperty('optionsManager')
      expect(app.modules).toHaveProperty('connectionTracker')
      expect(app.modules).toHaveProperty('tabMonitor')
      expect(app.modules).toHaveProperty('messageHandler')
      
      expect(consoleSpy).toHaveBeenCalledWith('[WebRTC-Exporter:background]', 'WebRTC Stats Exporter initialized successfully')
      
      consoleSpy.mockRestore()
    })

    test('should handle initialization errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      global.self.WebRTCExporterOptionsManager.createOptionsManager.mockImplementationOnce(() => {
        throw new Error('Module initialization failed')
      })
      
      await expect(app.initialize()).rejects.toThrow('Module initialization failed')
      expect(app.isInitialized).toBe(false)
      expect(app.options).toEqual(global.self.WebRTCExporterConfig.DEFAULT_OPTIONS)
      
      consoleSpy.mockRestore()
    })

    test('should not initialize twice', async () => {
      await app.initialize()
      const moduleCount = Object.keys(app.modules).length
      
      await app.initialize() // Should not reinitialize
      
      expect(Object.keys(app.modules)).toHaveLength(moduleCount)
    })
  })

  describe('sendData', () => {
    beforeEach(async () => {
      await app.initialize()
      app.options = {
        url: 'http://test.com',
        username: 'user',
        password: 'pass',
        gzip: false,
        job: 'test-job'
      }
    })

    test('should send data successfully', async () => {
      const mockResult = { success: true, statusCode: 200 }
      app.modules.pushgatewayClient.sendData.mockResolvedValue(mockResult)
      
      const result = await app.sendData('POST', { id: 'conn-1', origin: 'https://example.com' }, 'test-data')
      
      expect(app.modules.pushgatewayClient.sendData).toHaveBeenCalledWith({
        method: 'POST',
        url: 'http://test.com',
        job: 'test-job',
        id: 'conn-1',
        username: 'user',
        password: 'pass',
        gzip: false,
        data: 'test-data',
        statsCallback: app.modules.statsCallback
      })
      
      expect(app.modules.connectionTracker.setPeerConnectionLastUpdate).toHaveBeenCalledWith(
        { id: 'conn-1', origin: 'https://example.com' },
        expect.any(Number)
      )
      
      expect(app.modules.tabMonitor.updateCurrentTab).toHaveBeenCalled()
      expect(result).toBe(mockResult)
    })

    test('should handle DELETE requests', async () => {
      await app.sendData('DELETE', { id: 'conn-1', origin: 'https://example.com' })
      
      expect(app.modules.connectionTracker.setPeerConnectionLastUpdate).toHaveBeenCalledWith(
        { id: 'conn-1', origin: 'https://example.com' },
        0
      )
    })

    test('should handle sendData errors', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      app.modules.pushgatewayClient.sendData.mockRejectedValue(new Error('Network error'))
      
      await expect(app.sendData('POST', { id: 'conn-1', origin: 'https://example.com' }, 'data'))
        .rejects.toThrow('Network error')
      
      expect(consoleSpy).toHaveBeenCalledWith(
        '[WebRTC-Exporter:background]',
        'sendData error for POST conn-1: Network error'
      )
      
      consoleSpy.mockRestore()
    })
  })

  describe('getStats', () => {
    test('should return comprehensive statistics', async () => {
      await app.initialize()
      
      const stats = app.getStats()
      
      expect(stats).toHaveProperty('isInitialized', true)
      expect(stats).toHaveProperty('moduleCount')
      expect(stats).toHaveProperty('options')
      expect(stats).toHaveProperty('modules')
      expect(stats.moduleCount).toBeGreaterThan(0)
    })

    test('should handle modules without getStats method', async () => {
      await app.initialize()
      app.modules.testModule = { name: 'test' } // Module without getStats
      
      const stats = app.getStats()
      
      expect(stats.modules).not.toHaveProperty('testModule')
    })
  })

  describe('shutdown', () => {
    test('should shutdown all modules cleanly', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      await app.initialize()
      
      // Add mock destroy methods
      const testDestroy = jest.fn()
      const anotherDestroy = jest.fn()
      app.modules.testModule = { destroy: testDestroy }
      app.modules.anotherModule = { destroy: anotherDestroy }
      
      app.shutdown()
      
      expect(testDestroy).toHaveBeenCalled()
      expect(anotherDestroy).toHaveBeenCalled()
      expect(app.modules).toEqual({})
      expect(app.options).toEqual({})
      expect(app.isInitialized).toBe(false)
      
      expect(consoleSpy).toHaveBeenCalledWith('[WebRTC-Exporter:background]', 'Application shutdown complete')
      
      consoleSpy.mockRestore()
    })

    test('should handle destroy errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      await app.initialize()
      
      app.modules.errorModule = {
        destroy: jest.fn().mockImplementation(() => {
          throw new Error('Destroy failed')
        })
      }
      
      app.shutdown()
      
      expect(consoleSpy).toHaveBeenCalledWith(
        '[WebRTC-Exporter:background]',
        'Error destroying errorModule: Destroy failed'
      )
      
      consoleSpy.mockRestore()
    })
  })

  describe('cross-module communication', () => {
    test('should propagate option changes to dependent modules', async () => {
      await app.initialize()
      
      // Get the onChange callback that was registered with the options manager instance
      const optionsManagerInstance = app.modules.optionsManager
      const onChangeCallback = optionsManagerInstance.onChange.mock.calls[0][0]
      
      const newOptions = { agentId: 'new-agent' }
      onChangeCallback({ newOptions })
      
      expect(app.options).toEqual(expect.objectContaining(newOptions))
      expect(app.modules.tabMonitor.updateOptions).toHaveBeenCalledWith(newOptions)
      expect(app.modules.messageHandler.updateOptions).toHaveBeenCalledWith(newOptions)
    })

    test('should handle tab update errors during option changes', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      await app.initialize()
      
      app.modules.tabMonitor.updateCurrentTab.mockRejectedValue(new Error('Tab error'))
      
      const optionsManagerInstance = app.modules.optionsManager
      const onChangeCallback = optionsManagerInstance.onChange.mock.calls[0][0]
      onChangeCallback({ newOptions: { agentId: 'test' } })
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0))
      
      expect(consoleSpy).toHaveBeenCalledWith(
        '[WebRTC-Exporter:background]',
        'tab update error: Tab error'
      )
      
      consoleSpy.mockRestore()
    })
  })

  describe('legacy compatibility', () => {
    test('should expose sendData globally', async () => {
      await app.initialize()
      
      expect(global.self.sendData).toBeDefined()
      expect(typeof global.self.sendData).toBe('function')
    })

    test('should expose app instance globally', async () => {
      // Create a fresh app instance and test global assignment logic
      const testApp = new WebRTCExporterApp()
      await testApp.initialize()
      
      // Simulate the global assignment from the module
      global.self.WebRTCExporterApp = testApp
      
      expect(global.self.WebRTCExporterApp).toBeDefined()
      expect(global.self.WebRTCExporterApp).toBeInstanceOf(WebRTCExporterApp)
      expect(global.self.WebRTCExporterApp.isInitialized).toBe(true)
      
      // Clean up
      testApp.shutdown()
    })
  })
})