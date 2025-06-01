/**
 * Unit tests for ResourceTracker (memory leak prevention)
 */

const fs = require('fs')
const path = require('path')

describe('ResourceTracker', () => {
  let ResourceTracker, createResourceTracker, getGlobalTracker, destroyGlobalTracker
  let tracker
  let mockLogger

  beforeAll(() => {
    // Load the lifecycle manager module directly
    const modulePath = path.join(__dirname, '../../shared/lifecycle-manager.js')
    const moduleCode = fs.readFileSync(modulePath, 'utf8')
    
    // Execute the module code
    const moduleFunction = new Function('global', 'globalThis', 'self', 'window', 'console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', moduleCode)
    moduleFunction(global, global, global, global, console, global.setTimeout, global.setInterval, global.clearTimeout, global.clearInterval)
    
    // Get the exported classes
    const exports = global.WebRTCExporterLifecycleManager
    ResourceTracker = exports.ResourceTracker
    createResourceTracker = exports.createResourceTracker
    getGlobalTracker = exports.getGlobalTracker
    destroyGlobalTracker = exports.destroyGlobalTracker
  })

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      log: jest.fn()
    }

    tracker = new ResourceTracker('TestTracker')
    tracker.setLogger(mockLogger)
  })

  afterEach(() => {
    // Clean up any remaining trackers
    if (tracker && !tracker.isDestroyed) {
      tracker.destroy()
    }
    destroyGlobalTracker()
    jest.clearAllMocks()
  })

  describe('ResourceTracker constructor', () => {
    test('should initialize with default values', () => {
      const newTracker = new ResourceTracker('TestName')
      
      expect(newTracker.name).toBe('TestName')
      expect(newTracker.isDestroyed).toBe(false)
      expect(newTracker.eventListeners.size).toBe(0)
      expect(newTracker.chromeListeners.size).toBe(0)
      expect(newTracker.timers.size).toBe(0)
      expect(newTracker.intervals.size).toBe(0)
    })

    test('should use default name if none provided', () => {
      const newTracker = new ResourceTracker()
      expect(newTracker.name).toBe('ResourceTracker')
    })
  })

  describe('registerChromeListener', () => {
    let mockChromeEvent

    beforeEach(() => {
      mockChromeEvent = {
        addListener: jest.fn(),
        constructor: { name: 'MockChromeEvent' }
      }
    })

    test('should register Chrome listener and return cleanup function', () => {
      const mockHandler = jest.fn()
      const cleanup = tracker.registerChromeListener(mockChromeEvent, mockHandler)

      expect(mockChromeEvent.addListener).toHaveBeenCalledWith(mockHandler)
      expect(tracker.chromeListeners.size).toBe(1)
      expect(typeof cleanup).toBe('function')
      expect(mockLogger.log).toHaveBeenCalledWith('[TestTracker]', 'Registered Chrome listener for MockChromeEvent')
    })

    test('should not register when destroyed', () => {
      tracker.destroy()
      const mockHandler = jest.fn()
      
      const cleanup = tracker.registerChromeListener(mockChromeEvent, mockHandler)

      expect(mockChromeEvent.addListener).not.toHaveBeenCalled()
      expect(tracker.chromeListeners.size).toBe(0)
      expect(typeof cleanup).toBe('function')
    })
  })

  describe('registerTimeout', () => {
    test('should register timeout and return timer ID', () => {
      const mockCallback = jest.fn()
      const timerId = tracker.registerTimeout(mockCallback, 100)

      expect(timerId).toBeDefined()
      expect(timerId).not.toBe(0)
      expect(tracker.timers.has(timerId)).toBe(true)
    })

    test('should remove timer from tracking when it fires', (done) => {
      const mockCallback = jest.fn(() => {
        setTimeout(() => {
          expect(tracker.timers.size).toBe(0)
          done()
        }, 10)
      })

      const timerId = tracker.registerTimeout(mockCallback, 50)
      expect(tracker.timers.has(timerId)).toBe(true)
    })
  })

  describe('destroy', () => {
    test('should clean up all resources', () => {
      const mockChromeEvent = { addListener: jest.fn() }
      const mockCallback = jest.fn()
      
      // Register various resources
      tracker.registerChromeListener(mockChromeEvent, mockCallback)
      const timerId = tracker.registerTimeout(mockCallback, 5000)
      const intervalId = tracker.registerInterval(mockCallback, 1000)

      // Verify resources are tracked
      expect(tracker.chromeListeners.size).toBe(1)
      expect(tracker.timers.size).toBe(1)
      expect(tracker.intervals.size).toBe(1)

      // Destroy tracker
      tracker.destroy()

      // Verify cleanup
      expect(tracker.chromeListeners.size).toBe(0)
      expect(tracker.timers.size).toBe(0)
      expect(tracker.intervals.size).toBe(0)
      expect(tracker.isDestroyed).toBe(true)
    })
  })

  describe('getGlobalTracker', () => {
    test('should create and return global tracker', () => {
      const globalTracker = getGlobalTracker(mockLogger)
      
      expect(globalTracker).toBeInstanceOf(ResourceTracker)
      expect(globalTracker.name).toBe('GlobalTracker')
      expect(globalTracker.logger).toBe(mockLogger)
    })

    test('should return same instance on subsequent calls', () => {
      const tracker1 = getGlobalTracker()
      const tracker2 = getGlobalTracker()
      
      expect(tracker1).toBe(tracker2)
    })
  })

  describe('memory leak prevention integration', () => {
    test('should prevent memory leaks in Chrome extension modules', () => {
      // Simulate TabMonitor setup
      const tabTracker = createResourceTracker('TabMonitor')
      const mockTabsEvent = { addListener: jest.fn() }
      
      tabTracker.registerChromeListener(mockTabsEvent, jest.fn())
      expect(tabTracker.getStats().totalResources).toBe(1)
      
      // Simulate MessageHandler setup
      const msgTracker = createResourceTracker('MessageHandler')
      const mockRuntimeEvent = { addListener: jest.fn() }
      
      msgTracker.registerChromeListener(mockRuntimeEvent, jest.fn())
      expect(msgTracker.getStats().totalResources).toBe(1)
      
      // Simulate app shutdown - should clean up all resources
      tabTracker.destroy()
      msgTracker.destroy()
      
      expect(tabTracker.isDestroyed).toBe(true)
      expect(msgTracker.isDestroyed).toBe(true)
      expect(tabTracker.getStats().totalResources).toBe(0)
      expect(msgTracker.getStats().totalResources).toBe(0)
    })
  })
})