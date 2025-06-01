/**
 * Unit tests for LifecycleManager module
 */

const fs = require('fs')
const path = require('path')

describe('LifecycleManager', () => {
  let LifecycleManager, LifecycleError, createLifecycleManager, createAndInitializeLifecycleManager
  let mockStorageManager, mockConfig, mockLogger, mockChrome
  let manager

  beforeAll(() => {
    // Load the lifecycle manager module directly
    const modulePath = path.join(__dirname, '../../background/lifecycle-manager.js')
    const moduleCode = fs.readFileSync(modulePath, 'utf8')
    
    // Mock Chrome APIs globally
    global.chrome = {
      runtime: {
        onInstalled: {
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
      }
    }
    
    // Execute the module code
    const moduleFunction = new Function('global', 'globalThis', 'self', 'window', 'console', 'chrome', moduleCode)
    moduleFunction(global, global, global, global, console, global.chrome)
    
    // Get the exported classes
    const exports = global.WebRTCExporterLifecycle
    LifecycleManager = exports.LifecycleManager
    LifecycleError = exports.LifecycleError
    createLifecycleManager = exports.createLifecycleManager
    createAndInitializeLifecycleManager = exports.createAndInitializeLifecycleManager
  })

  beforeEach(() => {
    // Reset Chrome API mocks
    jest.clearAllMocks()
    
    // Mock storage manager
    mockStorageManager = {
      set: jest.fn().mockResolvedValue(),
      getSync: jest.fn().mockResolvedValue({})
    }

    // Mock config
    mockConfig = {
      DEFAULT_OPTIONS: {
        url: 'http://localhost:9091',
        username: '',
        password: '',
        updateInterval: 2,
        gzip: false,
        job: 'webrtc-internals-exporter',
        agentId: '',
        enabledOrigins: {}
      },
      CONSTANTS: {
        EXTENSION: {
          ALARM_NAME: 'webrtc-cleanup'
        },
        UPDATE_INTERVALS: {
          CLEANUP_INTERVAL_MINUTES: 60
        }
      }
    }

    // Mock logger
    mockLogger = {
      log: jest.fn()
    }

    // Mock Chrome APIs
    mockChrome = global.chrome
    mockChrome.alarms.create.mockResolvedValue()
    mockChrome.alarms.clear.mockResolvedValue(true)
    mockChrome.alarms.get.mockResolvedValue(null)
    mockChrome.alarms.getAll.mockResolvedValue([])

    manager = new LifecycleManager(mockStorageManager, mockConfig, mockLogger)
  })

  afterEach(() => {
    if (manager) {
      manager.destroy()
    }
  })

  describe('constructor', () => {
    test('should initialize with dependencies', () => {
      expect(manager.storageManager).toBe(mockStorageManager)
      expect(manager.config).toBe(mockConfig)
      expect(manager.logger).toBe(mockLogger)
      expect(manager.isInitialized).toBe(false)
      expect(manager.alarmHandlers.size).toBe(0)
    })
  })

  describe('initialize', () => {
    test('should set up event listeners successfully', async () => {
      await manager.initialize()

      expect(mockChrome.runtime.onInstalled.addListener).toHaveBeenCalledWith(expect.any(Function))
      expect(mockChrome.alarms.onAlarm.addListener).toHaveBeenCalledWith(expect.any(Function))
      expect(manager.isInitialized).toBe(true)
      expect(mockLogger.log).toHaveBeenCalledWith('LifecycleManager initialized successfully')
    })

    test('should not initialize twice', async () => {
      await manager.initialize()
      await manager.initialize()

      expect(mockChrome.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1)
      expect(mockLogger.log).toHaveBeenCalledWith('LifecycleManager already initialized')
    })

    test('should handle initialization errors', async () => {
      const error = new Error('Chrome API error')
      const originalAddListener = mockChrome.runtime.onInstalled.addListener
      mockChrome.runtime.onInstalled.addListener.mockImplementationOnce(() => {
        throw error
      })

      await expect(manager.initialize()).rejects.toThrow(LifecycleError)
      expect(manager.isInitialized).toBe(false)
      
      // Restore original mock for other tests
      mockChrome.runtime.onInstalled.addListener = originalAddListener
    })
  })

  describe('alarm handler management', () => {
    test('should register alarm handler', () => {
      const handler = jest.fn()
      const alarmName = 'test-alarm'

      manager.registerAlarmHandler(alarmName, handler)

      expect(manager.alarmHandlers.get(alarmName)).toBe(handler)
      expect(mockLogger.log).toHaveBeenCalledWith(`Registered alarm handler for: ${alarmName}`)
    })

    test('should throw error for non-function handler', () => {
      expect(() => manager.registerAlarmHandler('test', 'not-a-function'))
        .toThrow('Alarm handler must be a function')
    })

    test('should unregister alarm handler', () => {
      const handler = jest.fn()
      const alarmName = 'test-alarm'

      manager.registerAlarmHandler(alarmName, handler)
      const removed = manager.unregisterAlarmHandler(alarmName)

      expect(removed).toBe(true)
      expect(manager.alarmHandlers.has(alarmName)).toBe(false)
      expect(mockLogger.log).toHaveBeenCalledWith(`Unregistered alarm handler for: ${alarmName}`)
    })

    test('should return false when unregistering non-existent handler', () => {
      const removed = manager.unregisterAlarmHandler('non-existent')
      expect(removed).toBe(false)
    })
  })

  describe('alarm management', () => {
    test('should create alarm successfully', async () => {
      const alarmName = 'test-alarm'
      const config = { delayInMinutes: 5, periodInMinutes: 10 }

      await manager.createAlarm(alarmName, config)

      expect(mockChrome.alarms.create).toHaveBeenCalledWith(alarmName, config)
      expect(mockLogger.log).toHaveBeenCalledWith(`Created alarm: ${alarmName}`, config)
    })

    test('should handle alarm creation errors', async () => {
      const error = new Error('Alarm creation failed')
      mockChrome.alarms.create.mockRejectedValue(error)

      await expect(manager.createAlarm('test-alarm')).rejects.toThrow(LifecycleError)
      expect(mockLogger.log).toHaveBeenCalledWith(`Failed to create alarm test-alarm: ${error.message}`)
    })

    test('should clear alarm successfully', async () => {
      const alarmName = 'test-alarm'

      const result = await manager.clearAlarm(alarmName)

      expect(result).toBe(true)
      expect(mockChrome.alarms.clear).toHaveBeenCalledWith(alarmName)
      expect(mockLogger.log).toHaveBeenCalledWith(`Cleared alarm: ${alarmName}, success: true`)
    })

    test('should handle alarm clearing errors', async () => {
      const error = new Error('Clear failed')
      mockChrome.alarms.clear.mockRejectedValue(error)

      await expect(manager.clearAlarm('test-alarm')).rejects.toThrow(LifecycleError)
    })

    test('should get all alarms', async () => {
      const mockAlarms = [
        { name: 'alarm1', scheduledTime: Date.now() },
        { name: 'alarm2', scheduledTime: Date.now() + 1000 }
      ]
      mockChrome.alarms.getAll.mockResolvedValue(mockAlarms)

      const result = await manager.getAllAlarms()

      expect(result).toEqual(mockAlarms)
      expect(mockChrome.alarms.getAll).toHaveBeenCalled()
    })

    test('should handle get all alarms error gracefully', async () => {
      mockChrome.alarms.getAll.mockRejectedValue(new Error('API error'))

      const result = await manager.getAllAlarms()

      expect(result).toEqual([])
      expect(mockLogger.log).toHaveBeenCalledWith('Failed to get alarms: API error')
    })

    test('should get specific alarm', async () => {
      const mockAlarm = { name: 'test-alarm', scheduledTime: Date.now() }
      mockChrome.alarms.get.mockResolvedValue(mockAlarm)

      const result = await manager.getAlarm('test-alarm')

      expect(result).toEqual(mockAlarm)
      expect(mockChrome.alarms.get).toHaveBeenCalledWith('test-alarm')
    })

    test('should return null for non-existent alarm', async () => {
      mockChrome.alarms.get.mockResolvedValue(undefined)

      const result = await manager.getAlarm('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('setupDefaultAlarm', () => {
    test('should setup default alarm with config', async () => {
      await manager.setupDefaultAlarm()

      expect(mockChrome.alarms.create).toHaveBeenCalledWith('webrtc-cleanup', {
        delayInMinutes: 60,
        periodInMinutes: 60
      })
    })

    test('should throw error if alarm name missing from config', async () => {
      delete mockConfig.CONSTANTS.EXTENSION.ALARM_NAME

      await expect(manager.setupDefaultAlarm()).rejects.toThrow('Missing alarm configuration in config')
    })

    test('should use default interval if not specified', async () => {
      delete mockConfig.CONSTANTS.UPDATE_INTERVALS.CLEANUP_INTERVAL_MINUTES

      await manager.setupDefaultAlarm()

      expect(mockChrome.alarms.create).toHaveBeenCalledWith('webrtc-cleanup', {
        delayInMinutes: 60,
        periodInMinutes: 60
      })
    })
  })

  describe('handleInstall', () => {
    test('should handle fresh installation', async () => {
      await manager.handleInstall()

      expect(mockStorageManager.set).toHaveBeenCalledWith(mockConfig.DEFAULT_OPTIONS)
      expect(mockChrome.alarms.create).toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith('Extension installation completed successfully')
    })

    test('should throw error if default options missing', async () => {
      delete mockConfig.DEFAULT_OPTIONS

      await expect(manager.handleInstall()).rejects.toThrow('Missing default options in config')
    })

    test('should handle storage errors during install', async () => {
      mockStorageManager.set.mockRejectedValue(new Error('Storage failed'))

      await expect(manager.handleInstall()).rejects.toThrow(LifecycleError)
    })
  })

  describe('handleUpdate', () => {
    test('should handle extension update', async () => {
      const existingOptions = { agentId: 'existing-agent', customSetting: 'value' }
      mockStorageManager.getSync.mockResolvedValue(existingOptions)

      await manager.handleUpdate()

      const expectedMerged = {
        ...mockConfig.DEFAULT_OPTIONS,
        ...existingOptions
      }

      expect(mockStorageManager.set).toHaveBeenCalledWith(expectedMerged)
      expect(mockChrome.alarms.create).toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith('Extension update completed successfully')
    })

    test('should handle update with no existing options', async () => {
      mockStorageManager.getSync.mockResolvedValue({})

      await manager.handleUpdate()

      expect(mockStorageManager.set).toHaveBeenCalledWith(mockConfig.DEFAULT_OPTIONS)
    })

    test('should throw error if default options missing during update', async () => {
      delete mockConfig.DEFAULT_OPTIONS

      await expect(manager.handleUpdate()).rejects.toThrow('Missing default options in config')
    })
  })

  describe('private event handlers', () => {
    test('should handle install event', async () => {
      await manager.initialize()
      
      // Get the installed listener that was registered
      const installedListener = mockChrome.runtime.onInstalled.addListener.mock.calls[0][0]
      
      // Spy on handleInstall method
      const handleInstallSpy = jest.spyOn(manager, 'handleInstall').mockResolvedValue()
      
      await installedListener({ reason: 'install' })

      expect(handleInstallSpy).toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith('onInstalled event:', { reason: 'install', previousVersion: undefined })
    })

    test('should handle update event', async () => {
      await manager.initialize()
      
      const installedListener = mockChrome.runtime.onInstalled.addListener.mock.calls[0][0]
      const handleUpdateSpy = jest.spyOn(manager, 'handleUpdate').mockResolvedValue()
      
      await installedListener({ reason: 'update', previousVersion: '1.0.0' })

      expect(handleUpdateSpy).toHaveBeenCalled()
    })

    test('should handle unrecognized install reason', async () => {
      await manager.initialize()
      
      const installedListener = mockChrome.runtime.onInstalled.addListener.mock.calls[0][0]
      
      await installedListener({ reason: 'chrome_update' })

      expect(mockLogger.log).toHaveBeenCalledWith('Unhandled install reason: chrome_update')
    })

    test('should handle alarm events', async () => {
      const handler = jest.fn().mockResolvedValue()
      manager.registerAlarmHandler('test-alarm', handler)
      
      await manager.initialize()
      
      const alarmListener = mockChrome.alarms.onAlarm.addListener.mock.calls[0][0]
      
      await alarmListener({ name: 'test-alarm' })

      expect(handler).toHaveBeenCalledWith({ name: 'test-alarm' })
      expect(mockLogger.log).toHaveBeenCalledWith('Executing alarm handler for: test-alarm')
    })

    test('should handle alarm with no registered handler', async () => {
      await manager.initialize()
      
      const alarmListener = mockChrome.alarms.onAlarm.addListener.mock.calls[0][0]
      
      await alarmListener({ name: 'unknown-alarm' })

      expect(mockLogger.log).toHaveBeenCalledWith('No handler registered for alarm: unknown-alarm')
    })

    test('should handle alarm handler errors gracefully', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Handler failed'))
      manager.registerAlarmHandler('test-alarm', handler)
      
      await manager.initialize()
      
      const alarmListener = mockChrome.alarms.onAlarm.addListener.mock.calls[0][0]
      
      // Should not throw
      await alarmListener({ name: 'test-alarm' })

      expect(mockLogger.log).toHaveBeenCalledWith('Alarm handler error for test-alarm: Handler failed')
    })
  })

  describe('getStats', () => {
    test('should return lifecycle statistics', () => {
      manager.registerAlarmHandler('alarm1', jest.fn())
      manager.registerAlarmHandler('alarm2', jest.fn())

      const stats = manager.getStats()

      expect(stats).toEqual({
        isInitialized: false,
        registeredAlarmHandlers: ['alarm1', 'alarm2'],
        handlerCount: 2
      })
    })
  })

  describe('destroy', () => {
    test('should clean up resources', () => {
      manager.registerAlarmHandler('test', jest.fn())
      manager.isInitialized = true

      manager.destroy()

      expect(manager.alarmHandlers.size).toBe(0)
      expect(manager.isInitialized).toBe(false)
      expect(mockLogger.log).toHaveBeenCalledWith('LifecycleManager destroyed')
    })
  })

  describe('LifecycleError', () => {
    test('should create custom error', () => {
      const error = new LifecycleError('Test error message')
      
      expect(error.name).toBe('LifecycleError')
      expect(error.message).toBe('Test error message')
      expect(error instanceof Error).toBe(true)
    })
  })

  describe('createLifecycleManager', () => {
    test('should create manager with dependencies', () => {
      const manager = createLifecycleManager({
        storageManager: mockStorageManager,
        config: mockConfig,
        logger: mockLogger
      })

      expect(manager).toBeInstanceOf(LifecycleManager)
      expect(manager.storageManager).toBe(mockStorageManager)
      expect(manager.config).toBe(mockConfig)
      expect(manager.logger).toBe(mockLogger)
    })
  })

  describe('createAndInitializeLifecycleManager', () => {
    test('should create and initialize manager', async () => {
      const cleanupHandler = jest.fn()
      
      const manager = await createAndInitializeLifecycleManager({
        storageManager: mockStorageManager,
        config: mockConfig,
        logger: mockLogger
      }, cleanupHandler)

      expect(manager).toBeInstanceOf(LifecycleManager)
      expect(manager.isInitialized).toBe(true)
      expect(manager.alarmHandlers.get('webrtc-cleanup')).toBe(cleanupHandler)

      manager.destroy()
    })

    test('should work without cleanup handler', async () => {
      const manager = await createAndInitializeLifecycleManager({
        storageManager: mockStorageManager,
        config: mockConfig,
        logger: mockLogger
      })

      expect(manager.isInitialized).toBe(true)
      expect(manager.alarmHandlers.size).toBe(0)

      manager.destroy()
    })
  })
})