/**
 * Unit tests for OptionsManager module
 */

const fs = require('fs')
const path = require('path')

describe('OptionsManager', () => {
  let OptionsManager, OptionsError, createOptionsManager, createAndInitializeOptionsManager
  let mockStorageManager, mockConfig
  let manager

  beforeAll(() => {
    // Load the options manager module directly
    const modulePath = path.join(__dirname, '../../background/options-manager.js')
    const moduleCode = fs.readFileSync(modulePath, 'utf8')
    
    // Execute the module code
    const moduleFunction = new Function('global', 'globalThis', 'self', 'window', 'console', moduleCode)
    moduleFunction(global, global, global, global, console)
    
    // Get the exported classes
    const exports = global.WebRTCExporterOptionsManager
    OptionsManager = exports.OptionsManager
    OptionsError = exports.OptionsError
    createOptionsManager = exports.createOptionsManager
    createAndInitializeOptionsManager = exports.createAndInitializeOptionsManager
  })

  beforeEach(() => {
    // Mock storage manager
    mockStorageManager = {
      getOptions: jest.fn(),
      set: jest.fn(),
      onChanged: jest.fn()
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
        useProxy: false,
        proxyUrl: '',
        apiKey: '',
        enabledOrigins: {},
        enabledStats: ['inbound-rtp', 'remote-inbound-rtp', 'outbound-rtp']
      },
      validateConfig: jest.fn()
    }

    manager = new OptionsManager(mockStorageManager, mockConfig)
  })

  afterEach(() => {
    if (manager) {
      manager.destroy()
    }
    jest.clearAllMocks()
  })

  describe('constructor', () => {
    test('should initialize with default state', () => {
      expect(manager.options).toEqual({})
      expect(manager.isLoaded).toBe(false)
      expect(manager.loadPromise).toBeNull()
      expect(manager.changeListeners.size).toBe(0)
      expect(manager.loadListeners.size).toBe(0)
    })
  })

  describe('initialize', () => {
    test('should load options successfully', async () => {
      const testOptions = {
        url: 'http://test.com',
        agentId: 'test-agent',
        updateInterval: 5
      }
      
      mockStorageManager.getOptions.mockResolvedValue(testOptions)
      mockStorageManager.onChanged.mockReturnValue(jest.fn()) // Mock unsubscribe function

      const result = await manager.initialize()

      expect(mockStorageManager.getOptions).toHaveBeenCalled()
      expect(mockStorageManager.onChanged).toHaveBeenCalled()
      expect(manager.isLoaded).toBe(true)
      expect(manager.options).toEqual(testOptions)
      expect(result).toEqual(testOptions)
    })

    test('should load proxy settings', async () => {
      const testOptions = {
        useProxy: true,
        proxyUrl: 'https://proxy',
        apiKey: 'abc'
      }

      mockStorageManager.getOptions.mockResolvedValue(testOptions)
      mockStorageManager.onChanged.mockReturnValue(jest.fn())

      await manager.initialize()

      expect(manager.options.useProxy).toBe(true)
      expect(manager.options.proxyUrl).toBe('https://proxy')
      expect(manager.options.apiKey).toBe('abc')
    })

    test('should return same promise on concurrent calls', async () => {
      mockStorageManager.getOptions.mockResolvedValue({})
      mockStorageManager.onChanged.mockReturnValue(jest.fn())

      const promise1 = manager.initialize()
      const promise2 = manager.initialize()

      expect(promise1).toBe(promise2)
      await promise1
    })

    test('should return options directly if already loaded', async () => {
      const testOptions = { url: 'test' }
      mockStorageManager.getOptions.mockResolvedValue(testOptions)
      mockStorageManager.onChanged.mockReturnValue(jest.fn())

      await manager.initialize()
      const result = await manager.initialize()

      expect(result).toEqual(testOptions)
      expect(mockStorageManager.getOptions).toHaveBeenCalledTimes(1) // Only called once
    })

    test('should fallback to defaults on storage error', async () => {
      mockStorageManager.getOptions.mockRejectedValue(new Error('Storage error'))
      mockStorageManager.onChanged.mockReturnValue(jest.fn())

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      const result = await manager.initialize()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[OptionsManager] Error loading options, using defaults:',
        expect.any(Error)
      )
      expect(manager.options).toEqual(mockConfig.DEFAULT_OPTIONS)
      expect(result).toEqual(mockConfig.DEFAULT_OPTIONS)

      consoleSpy.mockRestore()
    })

    test('should set up storage change listener', async () => {
      mockStorageManager.getOptions.mockResolvedValue({})
      const mockUnsubscribe = jest.fn()
      mockStorageManager.onChanged.mockReturnValue(mockUnsubscribe)

      await manager.initialize()

      expect(mockStorageManager.onChanged).toHaveBeenCalledWith(expect.any(Function))
      expect(manager.storageUnsubscribe).toBe(mockUnsubscribe)
    })
  })

  describe('getOptions', () => {
    test('should return options when loaded', async () => {
      const testOptions = { url: 'http://test.com', agentId: 'test' }
      mockStorageManager.getOptions.mockResolvedValue(testOptions)
      mockStorageManager.onChanged.mockReturnValue(jest.fn())

      await manager.initialize()
      const result = manager.getOptions()

      expect(result).toEqual(testOptions)
      expect(result).not.toBe(manager.options) // Should return copy
    })

    test('should throw error when not loaded', () => {
      expect(() => manager.getOptions()).toThrow('Options not loaded yet. Call initialize() first.')
    })
  })

  describe('getOption', () => {
    test('should return specific option value', async () => {
      const testOptions = { url: 'http://test.com', agentId: 'test' }
      mockStorageManager.getOptions.mockResolvedValue(testOptions)
      mockStorageManager.onChanged.mockReturnValue(jest.fn())

      await manager.initialize()

      expect(manager.getOption('url')).toBe('http://test.com')
      expect(manager.getOption('agentId')).toBe('test')
      expect(manager.getOption('nonexistent')).toBeUndefined()
      expect(manager.getOption('nonexistent', 'default')).toBe('default')
    })

    test('should throw error when not loaded', () => {
      expect(() => manager.getOption('url')).toThrow('Options not loaded yet. Call initialize() first.')
    })
  })

  describe('updateOptions', () => {
    test('should update options successfully', async () => {
      const initialOptions = { url: 'http://old.com', agentId: 'old' }
      const updates = { agentId: 'new-agent' }
      const expectedFinal = { url: 'http://old.com', agentId: 'new-agent' }

      mockStorageManager.getOptions.mockResolvedValue(initialOptions)
      mockStorageManager.onChanged.mockReturnValue(jest.fn())
      mockConfig.validateConfig.mockReturnValue({ isValid: true, errors: [] })
      mockStorageManager.set.mockResolvedValue()

      await manager.initialize()
      
      // Mock the getOptions call in updateOptions
      mockStorageManager.getOptions.mockResolvedValueOnce(initialOptions)
      
      await manager.updateOptions(updates)

      expect(mockConfig.validateConfig).toHaveBeenCalledWith(updates)
      expect(mockStorageManager.set).toHaveBeenCalledWith(expectedFinal)
    })

    test('should update proxy settings', async () => {
      const initialOptions = { useProxy: false }
      const updates = { useProxy: true, proxyUrl: 'https://proxy', apiKey: 'k' }

      mockStorageManager.getOptions.mockResolvedValue(initialOptions)
      mockStorageManager.onChanged.mockReturnValue(jest.fn())
      mockConfig.validateConfig.mockReturnValue({ isValid: true, errors: [] })
      mockStorageManager.set.mockResolvedValue()

      await manager.initialize()

      mockStorageManager.getOptions.mockResolvedValueOnce(initialOptions)

      await manager.updateOptions(updates)

      expect(mockStorageManager.set).toHaveBeenCalledWith({
        ...initialOptions,
        ...updates
      })
    })

    test('should validate options before updating', async () => {
      mockStorageManager.getOptions.mockResolvedValue({})
      mockStorageManager.onChanged.mockReturnValue(jest.fn())
      mockConfig.validateConfig.mockReturnValue({
        isValid: false,
        errors: ['Invalid URL format']
      })

      await manager.initialize()

      await expect(manager.updateOptions({ url: 'invalid-url' }))
        .rejects.toThrow(OptionsError)

      expect(mockStorageManager.set).not.toHaveBeenCalled()
    })

    test('should reject invalid proxy settings', async () => {
      mockStorageManager.getOptions.mockResolvedValue({})
      mockStorageManager.onChanged.mockReturnValue(jest.fn())
      mockConfig.validateConfig.mockReturnValue({
        isValid: false,
        errors: ['Proxy URL missing']
      })

      await manager.initialize()

      await expect(manager.updateOptions({ useProxy: true }))
        .rejects.toThrow(OptionsError)

      expect(mockStorageManager.set).not.toHaveBeenCalled()
    })

    test('should initialize if not loaded', async () => {
      const updates = { agentId: 'new-agent' }
      
      mockStorageManager.getOptions.mockResolvedValue({})
      mockStorageManager.onChanged.mockReturnValue(jest.fn())
      mockConfig.validateConfig.mockReturnValue({ isValid: true, errors: [] })
      mockStorageManager.set.mockResolvedValue()

      await manager.updateOptions(updates)

      expect(manager.isLoaded).toBe(true)
      expect(mockStorageManager.set).toHaveBeenCalled()
    })
  })

  describe('reload', () => {
    test('should reload options from storage', async () => {
      const initialOptions = { url: 'http://old.com' }
      const reloadedOptions = { url: 'http://new.com' }

      mockStorageManager.getOptions
        .mockResolvedValueOnce(initialOptions)
        .mockResolvedValueOnce(reloadedOptions)
      mockStorageManager.onChanged.mockReturnValue(jest.fn())

      await manager.initialize()
      expect(manager.getOption('url')).toBe('http://old.com')

      const result = await manager.reload()

      expect(result).toEqual(reloadedOptions)
      expect(manager.getOption('url')).toBe('http://new.com')
    })
  })

  describe('onChange', () => {
    test('should add and remove change listeners', async () => {
      const listener1 = jest.fn()
      const listener2 = jest.fn()

      const unsubscribe1 = manager.onChange(listener1)
      const unsubscribe2 = manager.onChange(listener2)

      expect(manager.changeListeners.size).toBe(2)

      unsubscribe1()
      expect(manager.changeListeners.size).toBe(1)

      unsubscribe2()
      expect(manager.changeListeners.size).toBe(0)
    })

    test('should throw error for non-function listener', () => {
      expect(() => manager.onChange('not a function')).toThrow('Listener must be a function')
    })

    test('should notify change listeners on storage change', async () => {
      const listener = jest.fn()
      let storageChangeHandler

      mockStorageManager.getOptions.mockResolvedValue({ url: 'http://test.com' })
      mockStorageManager.onChanged.mockImplementation((handler) => {
        storageChangeHandler = handler
        return jest.fn()
      })

      await manager.initialize()
      manager.onChange(listener)

      // Simulate storage change
      const changes = {
        agentId: { newValue: 'new-agent' }
      }
      storageChangeHandler(changes)

      expect(listener).toHaveBeenCalledWith({
        changed: ['agentId'],
        oldOptions: { url: 'http://test.com' },
        newOptions: { url: 'http://test.com', agentId: 'new-agent' }
      })
    })

    test('should handle errors in change listeners gracefully', async () => {
      const errorListener = jest.fn().mockImplementation(() => {
        throw new Error('Listener error')
      })
      const goodListener = jest.fn()
      let storageChangeHandler

      mockStorageManager.getOptions.mockResolvedValue({})
      mockStorageManager.onChanged.mockImplementation((handler) => {
        storageChangeHandler = handler
        return jest.fn()
      })

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      await manager.initialize()
      manager.onChange(errorListener)
      manager.onChange(goodListener)

      // Simulate storage change
      storageChangeHandler({ agentId: { newValue: 'test' } })

      expect(consoleSpy).toHaveBeenCalledWith(
        '[OptionsManager] Error in change listener:',
        expect.any(Error)
      )
      expect(goodListener).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('onLoad', () => {
    test('should add and remove load listeners', () => {
      const listener1 = jest.fn()
      const listener2 = jest.fn()

      const unsubscribe1 = manager.onLoad(listener1)
      const unsubscribe2 = manager.onLoad(listener2)

      expect(manager.loadListeners.size).toBe(2)

      unsubscribe1()
      expect(manager.loadListeners.size).toBe(1)

      unsubscribe2()
      expect(manager.loadListeners.size).toBe(0)
    })

    test('should call listener immediately if already loaded', async () => {
      const testOptions = { url: 'http://test.com' }
      mockStorageManager.getOptions.mockResolvedValue(testOptions)
      mockStorageManager.onChanged.mockReturnValue(jest.fn())

      await manager.initialize()

      const listener = jest.fn()
      manager.onLoad(listener)

      expect(listener).toHaveBeenCalledWith(testOptions)
    })

    test('should call load listeners on initialization', async () => {
      const listener1 = jest.fn()
      const listener2 = jest.fn()
      const testOptions = { url: 'http://test.com' }

      manager.onLoad(listener1)
      manager.onLoad(listener2)

      mockStorageManager.getOptions.mockResolvedValue(testOptions)
      mockStorageManager.onChanged.mockReturnValue(jest.fn())

      await manager.initialize()

      expect(listener1).toHaveBeenCalledWith(testOptions)
      expect(listener2).toHaveBeenCalledWith(testOptions)
      expect(manager.loadListeners.size).toBe(0) // Should be cleared after calling
    })

    test('should handle errors in load listeners gracefully', async () => {
      const errorListener = jest.fn().mockImplementation(() => {
        throw new Error('Load listener error')
      })
      const goodListener = jest.fn()

      manager.onLoad(errorListener)
      manager.onLoad(goodListener)

      mockStorageManager.getOptions.mockResolvedValue({})
      mockStorageManager.onChanged.mockReturnValue(jest.fn())

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      await manager.initialize()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[OptionsManager] Error in load listener:',
        expect.any(Error)
      )
      expect(goodListener).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('isOptionsLoaded', () => {
    test('should return load status', async () => {
      expect(manager.isOptionsLoaded()).toBe(false)

      mockStorageManager.getOptions.mockResolvedValue({})
      mockStorageManager.onChanged.mockReturnValue(jest.fn())

      await manager.initialize()

      expect(manager.isOptionsLoaded()).toBe(true)
    })
  })

  describe('getStats', () => {
    test('should return manager statistics', async () => {
      const stats = manager.getStats()

      expect(stats).toHaveProperty('isLoaded', false)
      expect(stats).toHaveProperty('optionCount', 0)
      expect(stats).toHaveProperty('changeListenerCount', 0)
      expect(stats).toHaveProperty('loadListenerCount', 0)
      expect(stats).toHaveProperty('hasStorageListener', false)

      // After initialization
      mockStorageManager.getOptions.mockResolvedValue({ url: 'test', agentId: 'test' })
      mockStorageManager.onChanged.mockReturnValue(jest.fn())

      await manager.initialize()
      manager.onChange(() => {})
      manager.onLoad(() => {})

      const newStats = manager.getStats()
      expect(newStats.isLoaded).toBe(true)
      expect(newStats.optionCount).toBe(2)
      expect(newStats.changeListenerCount).toBe(1)
      expect(newStats.hasStorageListener).toBe(true)
    })
  })

  describe('destroy', () => {
    test('should clean up all resources', async () => {
      const mockUnsubscribe = jest.fn()
      mockStorageManager.getOptions.mockResolvedValue({})
      mockStorageManager.onChanged.mockReturnValue(mockUnsubscribe)

      await manager.initialize()
      manager.onChange(() => {})
      manager.onLoad(() => {})

      manager.destroy()

      expect(mockUnsubscribe).toHaveBeenCalled()
      expect(manager.changeListeners.size).toBe(0)
      expect(manager.loadListeners.size).toBe(0)
      expect(manager.options).toEqual({})
      expect(manager.isLoaded).toBe(false)
      expect(manager.loadPromise).toBeNull()
    })
  })

  describe('OptionsError', () => {
    test('should create custom error', () => {
      const error = new OptionsError('Test error message')
      
      expect(error.name).toBe('OptionsError')
      expect(error.message).toBe('Test error message')
      expect(error instanceof Error).toBe(true)
    })
  })

  describe('createOptionsManager', () => {
    test('should create manager with dependencies', () => {
      const manager = createOptionsManager({
        storageManager: mockStorageManager,
        config: mockConfig
      })

      expect(manager).toBeInstanceOf(OptionsManager)
      expect(manager.storageManager).toBe(mockStorageManager)
      expect(manager.config).toBe(mockConfig)
    })
  })

  describe('createAndInitializeOptionsManager', () => {
    test('should create and initialize manager', async () => {
      mockStorageManager.getOptions.mockResolvedValue({ url: 'test' })
      mockStorageManager.onChanged.mockReturnValue(jest.fn())

      const manager = await createAndInitializeOptionsManager({
        storageManager: mockStorageManager,
        config: mockConfig
      })

      expect(manager).toBeInstanceOf(OptionsManager)
      expect(manager.isOptionsLoaded()).toBe(true)
      expect(manager.getOption('url')).toBe('test')

      manager.destroy()
    })
  })
})
