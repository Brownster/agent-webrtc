/**
 * Unit tests for Storage Circuit Breaker (Phase 3.2)
 */

const fs = require('fs')
const path = require('path')

describe('StorageCircuitBreaker', () => {
  let StorageCircuitBreaker, StorageCircuitBreakerError, StorageFallbackManager
  let circuitBreaker, fallbackManager
  let mockLogger

  beforeAll(() => {
    jest.useFakeTimers()
    // Load the storage circuit breaker module directly
    const modulePath = path.join(__dirname, '../../shared/storage-circuit-breaker.js')
    const moduleCode = fs.readFileSync(modulePath, 'utf8')
    
    // Execute the module code
    const moduleFunction = new Function('global', 'globalThis', 'self', 'window', 'console', 'setTimeout', 'clearTimeout', moduleCode)
    moduleFunction(global, global, global, global, console, global.setTimeout, global.clearTimeout)
    
    // Get the exported classes
    const exports = global.WebRTCExporterStorageCircuitBreaker
    StorageCircuitBreaker = exports.StorageCircuitBreaker
    StorageCircuitBreakerError = exports.StorageCircuitBreakerError
    StorageFallbackManager = exports.StorageFallbackManager
  })

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      log: jest.fn()
    }

    circuitBreaker = new StorageCircuitBreaker(3, 10000) // Lower thresholds for testing
    circuitBreaker.setLogger(mockLogger)

    fallbackManager = new StorageFallbackManager()
    fallbackManager.setLogger(mockLogger)
  })

  afterEach(() => {
    jest.clearAllMocks()
    jest.clearAllTimers()
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('StorageCircuitBreaker constructor', () => {
    test('should initialize with default values', () => {
      const cb = new StorageCircuitBreaker()
      
      expect(cb.failureThreshold).toBe(5)
      expect(cb.resetTimeout).toBe(60000)
      expect(cb.state).toBe('CLOSED')
      expect(cb.failureCount).toBe(0)
    })

    test('should initialize with custom values', () => {
      const cb = new StorageCircuitBreaker(10, 30000)
      
      expect(cb.failureThreshold).toBe(10)
      expect(cb.resetTimeout).toBe(30000)
    })
  })

  describe('circuit breaker states', () => {
    test('should start in CLOSED state', () => {
      expect(circuitBreaker.state).toBe('CLOSED')
      expect(circuitBreaker.getStats().state).toBe('CLOSED')
    })

    test('should transition to OPEN after threshold failures', async () => {
      const failingOperation = jest.fn().mockRejectedValue(new Error('Storage failed'))

      // Cause failures to reach threshold
      for (let i = 0; i < 3; i++) {
        await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow('Storage failed')
      }

      expect(circuitBreaker.state).toBe('OPEN')
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[StorageCircuitBreaker]',
        expect.stringContaining('Circuit breaker OPENED after 3 failures')
      )
    })

    test('should block operations when OPEN', async () => {
      // Force circuit to OPEN state
      circuitBreaker.open()

      const operation = jest.fn()
      await expect(circuitBreaker.execute(operation)).rejects.toThrow(StorageCircuitBreakerError)
      
      expect(operation).not.toHaveBeenCalled()
    })

    test('should transition to HALF_OPEN after timeout', async () => {
      // Force circuit to OPEN state and set failure time in the past
      const pastTime = Date.now() - circuitBreaker.resetTimeout - 1000
      circuitBreaker.state = 'OPEN'
      circuitBreaker.lastFailureTime = pastTime
      
      const successOperation = jest.fn().mockResolvedValue('success')
      const result = await circuitBreaker.execute(successOperation)
      
      expect(circuitBreaker.state).toBe('HALF_OPEN')
      expect(result).toBe('success')
    })

    test('should transition from HALF_OPEN to CLOSED after successes', async () => {
      // Force to HALF_OPEN state
      circuitBreaker.state = 'HALF_OPEN'
      
      const successOperation = jest.fn().mockResolvedValue('success')
      
      // First success
      await circuitBreaker.execute(successOperation)
      expect(circuitBreaker.state).toBe('HALF_OPEN')
      
      // Second success should close circuit
      await circuitBreaker.execute(successOperation)
      expect(circuitBreaker.state).toBe('CLOSED')
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[StorageCircuitBreaker]',
        'Circuit breaker CLOSED - storage operations restored'
      )
    })

    test('should reopen from HALF_OPEN on failure', async () => {
      // Force to HALF_OPEN state
      circuitBreaker.state = 'HALF_OPEN'
      
      const failingOperation = jest.fn().mockRejectedValue(new Error('Still failing'))
      await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow('Still failing')
      
      expect(circuitBreaker.state).toBe('OPEN')
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[StorageCircuitBreaker]',
        expect.stringContaining('Circuit breaker reopened due to failure in HALF_OPEN')
      )
    })
  })

  describe('executeWithRetry', () => {
    test('should succeed on first attempt', async () => {
      const successOperation = jest.fn().mockResolvedValue('success')
      
      const result = await circuitBreaker.executeWithRetry(successOperation, 3, 100)
      
      expect(result).toBe('success')
      expect(successOperation).toHaveBeenCalledTimes(1)
    })

    test('should retry on transient failures', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockRejectedValueOnce(new Error('Another transient error'))
        .mockResolvedValueOnce('success')
      
      // Mock the delay function to avoid waiting
      const originalDelay = circuitBreaker.delay
      circuitBreaker.delay = jest.fn().mockResolvedValue()
      
      const result = await circuitBreaker.executeWithRetry(operation, 3, 10)
      
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(3)
      expect(circuitBreaker.delay).toHaveBeenCalledTimes(2) // Two retries
      
      // Restore original method
      circuitBreaker.delay = originalDelay
    })

    test('should not retry non-retryable errors', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('QUOTA_EXCEEDED'))
      
      await expect(circuitBreaker.executeWithRetry(operation, 3, 10))
        .rejects.toThrow('QUOTA_EXCEEDED')
      
      expect(operation).toHaveBeenCalledTimes(1) // No retries
    })

    test('should not retry when circuit is open', async () => {
      circuitBreaker.open()
      
      const operation = jest.fn()
      
      await expect(circuitBreaker.executeWithRetry(operation, 3, 10))
        .rejects.toThrow(StorageCircuitBreakerError)
      
      expect(operation).not.toHaveBeenCalled()
    })

    test('should exhaust retries and throw last error', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Persistent failure'))
      
      // Mock the delay function to avoid waiting
      const originalDelay = circuitBreaker.delay
      circuitBreaker.delay = jest.fn().mockResolvedValue()
      
      await expect(circuitBreaker.executeWithRetry(operation, 2, 10))
        .rejects.toThrow('Persistent failure')
      
      expect(operation).toHaveBeenCalledTimes(3) // Initial + 2 retries
      expect(circuitBreaker.delay).toHaveBeenCalledTimes(2) // Two retry delays
      
      // Restore original method
      circuitBreaker.delay = originalDelay
    })
  })

  describe('error classification', () => {
    test('should identify non-retryable errors', () => {
      expect(circuitBreaker.isNonRetryableError(new Error('QUOTA_EXCEEDED'))).toBe(true)
      expect(circuitBreaker.isNonRetryableError(new Error('invalid data'))).toBe(true)
      expect(circuitBreaker.isNonRetryableError(new Error('permission denied'))).toBe(true)
      expect(circuitBreaker.isNonRetryableError(new Error('extension context invalidated'))).toBe(true)
    })

    test('should identify retryable errors', () => {
      expect(circuitBreaker.isNonRetryableError(new Error('Network error'))).toBe(false)
      expect(circuitBreaker.isNonRetryableError(new Error('Timeout'))).toBe(false)
      expect(circuitBreaker.isNonRetryableError(new Error('Storage unavailable'))).toBe(false)
    })
  })

  describe('getStats', () => {
    test('should return correct statistics', () => {
      const stats = circuitBreaker.getStats()
      
      expect(stats).toEqual({
        state: 'CLOSED',
        failureCount: 0,
        failureThreshold: 3,
        successCount: 0,
        lastFailureTime: null,
        resetTimeout: 10000,
        timeUntilReset: 0
      })
    })

    test('should calculate time until reset correctly', () => {
      circuitBreaker.open()
      const stats = circuitBreaker.getStats()
      
      expect(stats.state).toBe('OPEN')
      expect(stats.timeUntilReset).toBeGreaterThan(0)
      expect(stats.timeUntilReset).toBeLessThanOrEqual(10000)
    })
  })

  describe('manual controls', () => {
    test('should reset circuit breaker manually', () => {
      // Force some failures and open state
      circuitBreaker.open()
      expect(circuitBreaker.state).toBe('OPEN')
      
      circuitBreaker.reset()
      
      expect(circuitBreaker.state).toBe('CLOSED')
      expect(circuitBreaker.failureCount).toBe(0)
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[StorageCircuitBreaker]',
        'Circuit breaker manually reset to CLOSED state'
      )
    })

    test('should open circuit breaker manually', () => {
      circuitBreaker.open()
      
      expect(circuitBreaker.state).toBe('OPEN')
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[StorageCircuitBreaker]',
        'Circuit breaker manually opened'
      )
    })
  })
})

describe('StorageFallbackManager', () => {
  let StorageCircuitBreaker, StorageCircuitBreakerError, StorageFallbackManager
  let fallbackManager
  let mockLogger

  beforeAll(() => {
    // Load the storage circuit breaker module directly
    const modulePath = path.join(__dirname, '../../shared/storage-circuit-breaker.js')
    const moduleCode = fs.readFileSync(modulePath, 'utf8')
    
    // Execute the module code
    const moduleFunction = new Function('global', 'globalThis', 'self', 'window', 'console', 'setTimeout', 'clearTimeout', moduleCode)
    moduleFunction(global, global, global, global, console, global.setTimeout, global.clearTimeout)
    
    // Get the exported classes
    const exports = global.WebRTCExporterStorageCircuitBreaker
    StorageCircuitBreaker = exports.StorageCircuitBreaker
    StorageCircuitBreakerError = exports.StorageCircuitBreakerError
    StorageFallbackManager = exports.StorageFallbackManager
  })

  beforeEach(() => {
    // Mock localStorage
    global.localStorage = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn()
    }

    mockLogger = {
      log: jest.fn()
    }

    fallbackManager = new StorageFallbackManager()
    fallbackManager.setLogger(mockLogger)
  })

  afterEach(() => {
    jest.clearAllMocks()
    delete global.localStorage
  })

  describe('setFallback', () => {
    test('should store data in memory and localStorage', async () => {
      const data = { option1: 'value1', option2: 'value2' }
      
      await fallbackManager.setFallback(data)
      
      expect(fallbackManager.memoryCache.get('option1')).toBe('value1')
      expect(fallbackManager.memoryCache.get('option2')).toBe('value2')
      expect(global.localStorage.setItem).toHaveBeenCalledWith(
        'webrtc-exporter-fallback',
        JSON.stringify(data)
      )
    })

    test('should handle localStorage errors gracefully', async () => {
      global.localStorage.setItem.mockImplementation(() => {
        throw new Error('localStorage failed')
      })
      
      const data = { option1: 'value1' }
      
      await fallbackManager.setFallback(data)
      
      // Should still store in memory
      expect(fallbackManager.memoryCache.get('option1')).toBe('value1')
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[StorageFallbackManager]',
        'Fallback storage failed: localStorage failed'
      )
    })
  })

  describe('getFallback', () => {
    test('should retrieve data from localStorage and memory', async () => {
      const localStorageData = { option1: 'local1', option2: 'local2' }
      global.localStorage.getItem.mockReturnValue(JSON.stringify(localStorageData))
      
      // Add some memory data that should override localStorage
      fallbackManager.memoryCache.set('option2', 'memory2')
      fallbackManager.memoryCache.set('option3', 'memory3')
      
      const result = await fallbackManager.getFallback()
      
      expect(result).toEqual({
        option1: 'local1',
        option2: 'memory2', // Memory cache takes precedence
        option3: 'memory3'
      })
    })

    test('should filter keys when specified', async () => {
      fallbackManager.memoryCache.set('option1', 'value1')
      fallbackManager.memoryCache.set('option2', 'value2')
      
      const result1 = await fallbackManager.getFallback('option1')
      expect(result1).toEqual({ option1: 'value1' })
      
      const result2 = await fallbackManager.getFallback(['option1', 'option3'])
      expect(result2).toEqual({ option1: 'value1', option3: undefined })
    })

    test('should handle localStorage errors', async () => {
      global.localStorage.getItem.mockImplementation(() => {
        throw new Error('localStorage failed')
      })
      
      fallbackManager.memoryCache.set('option1', 'value1')
      
      const result = await fallbackManager.getFallback()
      
      expect(result).toEqual({ option1: 'value1' })
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[StorageFallbackManager]',
        'Fallback retrieval failed: localStorage failed'
      )
    })
  })

  describe('clearFallback', () => {
    test('should clear memory and localStorage', () => {
      fallbackManager.memoryCache.set('option1', 'value1')
      
      fallbackManager.clearFallback()
      
      expect(fallbackManager.memoryCache.size).toBe(0)
      expect(global.localStorage.removeItem).toHaveBeenCalledWith('webrtc-exporter-fallback')
    })
  })

  describe('getStats', () => {
    test('should return fallback statistics', () => {
      fallbackManager.memoryCache.set('option1', 'value1')
      fallbackManager.memoryCache.set('option2', 'value2')
      
      const stats = fallbackManager.getStats()
      
      expect(stats).toEqual({
        memoryCacheSize: 2,
        memoryKeys: ['option1', 'option2'],
        hasLocalStorageFallback: true
      })
    })
  })
})

describe('Storage failure integration scenarios', () => {
  let StorageCircuitBreaker, StorageFallbackManager
  let circuitBreaker, fallbackManager

  beforeAll(() => {
    const modulePath = path.join(__dirname, '../../shared/storage-circuit-breaker.js')
    const moduleCode = fs.readFileSync(modulePath, 'utf8')
    const moduleFunction = new Function('global', 'globalThis', 'self', 'window', 'console', 'setTimeout', 'clearTimeout', moduleCode)
    moduleFunction(global, global, global, global, console, global.setTimeout, global.clearTimeout)
    
    const exports = global.WebRTCExporterStorageCircuitBreaker
    StorageCircuitBreaker = exports.StorageCircuitBreaker
    StorageFallbackManager = exports.StorageFallbackManager
  })

  beforeEach(() => {
    circuitBreaker = new StorageCircuitBreaker(2, 5000)
    fallbackManager = new StorageFallbackManager()
  })

  test('should handle quota exceeded scenario', async () => {
    const quotaError = new Error('QUOTA_EXCEEDED')
    const quotaOperation = jest.fn().mockRejectedValue(quotaError)
    
    // Should not retry quota exceeded errors
    await expect(circuitBreaker.executeWithRetry(quotaOperation))
      .rejects.toThrow('QUOTA_EXCEEDED')
    
    expect(quotaOperation).toHaveBeenCalledTimes(1)
    
    // Should still update failure count but not trigger circuit breaker
    expect(circuitBreaker.failureCount).toBe(1)
  })

  test('should provide graceful degradation with fallback', async () => {
    // Simulate primary storage failure
    const failingOperation = jest.fn().mockRejectedValue(new Error('Storage failed'))
    
    try {
      await circuitBreaker.execute(failingOperation)
    } catch (error) {
      // Fallback to alternative storage
      await fallbackManager.setFallback({ options: 'fallback_data' })
      const fallbackData = await fallbackManager.getFallback()
      expect(fallbackData.options).toBe('fallback_data')
    }
  })

  test('should recover after circuit breaker opens and closes', async () => {
    const failingOperation = jest.fn().mockRejectedValue(new Error('Storage failed'))
    const successOperation = jest.fn().mockResolvedValue('success')
    
    // Cause circuit to open
    for (let i = 0; i < 2; i++) {
      await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow()
    }
    expect(circuitBreaker.state).toBe('OPEN')
    
    // Manually set time in past to simulate timeout
    const pastTime = Date.now() - circuitBreaker.resetTimeout - 1000
    circuitBreaker.lastFailureTime = pastTime
    
    // Should transition to HALF_OPEN and then CLOSED
    await circuitBreaker.execute(successOperation)
    expect(circuitBreaker.state).toBe('HALF_OPEN')
    
    await circuitBreaker.execute(successOperation)
    expect(circuitBreaker.state).toBe('CLOSED')
  })
})
