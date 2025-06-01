/**
 * Unit tests for Network Circuit Breaker (Phase 3.3)
 */

const fs = require('fs')
const path = require('path')

describe('NetworkCircuitBreaker', () => {
  let NetworkCircuitBreaker, createNetworkCircuitBreaker
  let networkCircuitBreaker, mockPushgatewayClient, mockLogger

  beforeAll(() => {
    jest.useFakeTimers()
    
    // Load the network circuit breaker module directly
    const modulePath = path.join(__dirname, '../../background/network-circuit-breaker.js')
    const moduleCode = fs.readFileSync(modulePath, 'utf8')
    
    // Execute the module code
    const moduleFunction = new Function('global', 'globalThis', 'self', 'window', 'console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', moduleCode)
    moduleFunction(global, global, global, global, console, global.setTimeout, global.setInterval, global.clearTimeout, global.clearInterval)
    
    // Get the exported classes
    const exports = global.WebRTCExporterNetworkCircuitBreaker
    NetworkCircuitBreaker = exports.NetworkCircuitBreaker
    createNetworkCircuitBreaker = exports.createNetworkCircuitBreaker
  })

  beforeEach(() => {
    // Mock pushgateway client
    mockPushgatewayClient = {
      _sendDataDirect: jest.fn()
    }

    // Mock logger
    mockLogger = {
      log: jest.fn()
    }

    networkCircuitBreaker = new NetworkCircuitBreaker(mockPushgatewayClient, {
      failureThreshold: 3,
      resetTimeout: 10000,
      healthCheckInterval: 5000,
      maxQueueSize: 5
    })
    networkCircuitBreaker.setLogger(mockLogger)
  })

  afterEach(() => {
    if (networkCircuitBreaker) {
      networkCircuitBreaker.destroy()
    }
    jest.clearAllMocks()
    jest.clearAllTimers()
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('constructor', () => {
    test('should initialize with default values', () => {
      const cb = new NetworkCircuitBreaker(mockPushgatewayClient)
      
      expect(cb.state).toBe('CLOSED')
      expect(cb.failureThreshold).toBe(5)
      expect(cb.resetTimeout).toBe(60000)
      expect(cb.maxQueueSize).toBe(100)
      expect(cb.requestQueue).toEqual([])
    })

    test('should initialize with custom options', () => {
      const options = {
        failureThreshold: 10,
        resetTimeout: 30000,
        maxQueueSize: 50
      }
      const cb = new NetworkCircuitBreaker(mockPushgatewayClient, options)
      
      expect(cb.failureThreshold).toBe(10)
      expect(cb.resetTimeout).toBe(30000)
      expect(cb.maxQueueSize).toBe(50)
    })
  })

  describe('sendWithCircuitBreaker', () => {
    test('should send request successfully when circuit is CLOSED', async () => {
      mockPushgatewayClient._sendDataDirect.mockResolvedValue('success')
      
      const requestData = {
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      }
      
      const result = await networkCircuitBreaker.sendWithCircuitBreaker(requestData)
      
      expect(result).toBe('success')
      expect(mockPushgatewayClient._sendDataDirect).toHaveBeenCalledWith(requestData)
      expect(networkCircuitBreaker.stats.totalRequests).toBe(1)
      expect(networkCircuitBreaker.stats.successfulRequests).toBe(1)
    })

    test('should open circuit after threshold failures', async () => {
      const error = new Error('Network error')
      mockPushgatewayClient._sendDataDirect.mockRejectedValue(error)
      
      const requestData = {
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      }
      
      // Cause failures to reach threshold
      for (let i = 0; i < 3; i++) {
        await expect(networkCircuitBreaker.sendWithCircuitBreaker(requestData))
          .rejects.toThrow('Network error')
      }
      
      expect(networkCircuitBreaker.state).toBe('OPEN')
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[NetworkCircuitBreaker]',
        expect.stringContaining('Circuit opened after 3 consecutive failures')
      )
    })

    test('should queue requests when circuit is OPEN', async () => {
      // Force circuit to OPEN state
      networkCircuitBreaker.state = 'OPEN'
      
      const requestData = {
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      }
      
      const result = await networkCircuitBreaker.sendWithCircuitBreaker(requestData)
      
      expect(result.queued).toBe(true)
      expect(result.queuePosition).toBe(1)
      expect(networkCircuitBreaker.requestQueue).toHaveLength(1)
      expect(networkCircuitBreaker.stats.queuedRequests).toBe(1)
      expect(mockPushgatewayClient._sendDataDirect).not.toHaveBeenCalled()
    })

    test('should transition from OPEN to HALF_OPEN after timeout', async () => {
      // Force circuit to OPEN state with past failure time
      networkCircuitBreaker.state = 'OPEN'
      networkCircuitBreaker.lastFailureTime = Date.now() - 11000 // 11 seconds ago
      
      mockPushgatewayClient._sendDataDirect.mockResolvedValue('success')
      
      const requestData = {
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      }
      
      const result = await networkCircuitBreaker.sendWithCircuitBreaker(requestData)
      
      expect(result).toBe('success')
      expect(networkCircuitBreaker.state).toBe('HALF_OPEN')
    })

    test('should transition from HALF_OPEN to CLOSED after successes', async () => {
      // Force to HALF_OPEN state
      networkCircuitBreaker.state = 'HALF_OPEN'
      mockPushgatewayClient._sendDataDirect.mockResolvedValue('success')
      
      const requestData = {
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      }
      
      // First success
      await networkCircuitBreaker.sendWithCircuitBreaker(requestData)
      expect(networkCircuitBreaker.state).toBe('HALF_OPEN')
      
      // Second success should close circuit
      await networkCircuitBreaker.sendWithCircuitBreaker(requestData)
      expect(networkCircuitBreaker.state).toBe('CLOSED')
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[NetworkCircuitBreaker]',
        'Network circuit breaker CLOSED - processing queued requests'
      )
    })

    test('should reopen from HALF_OPEN on failure', async () => {
      // Force to HALF_OPEN state
      networkCircuitBreaker.state = 'HALF_OPEN'
      mockPushgatewayClient._sendDataDirect.mockRejectedValue(new Error('Still failing'))
      
      const requestData = {
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      }
      
      await expect(networkCircuitBreaker.sendWithCircuitBreaker(requestData))
        .rejects.toThrow('Still failing')
      
      expect(networkCircuitBreaker.state).toBe('OPEN')
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[NetworkCircuitBreaker]',
        expect.stringContaining('Circuit reopened due to failure in HALF_OPEN')
      )
    })
  })

  describe('request queuing', () => {
    beforeEach(() => {
      networkCircuitBreaker.state = 'OPEN'
    })

    test('should queue multiple requests', async () => {
      const requests = []
      for (let i = 0; i < 3; i++) {
        requests.push({
          method: 'POST',
          url: 'http://localhost:9091',
          job: 'test-job',
          id: `test-id-${i}`,
          data: `test_metric_${i} 1`
        })
      }
      
      for (const request of requests) {
        await networkCircuitBreaker.sendWithCircuitBreaker(request)
      }
      
      expect(networkCircuitBreaker.requestQueue).toHaveLength(3)
      expect(networkCircuitBreaker.stats.queuedRequests).toBe(3)
    })

    test('should drop oldest requests when queue is full', async () => {
      // Fill queue to capacity
      for (let i = 0; i < 6; i++) { // maxQueueSize is 5
        await networkCircuitBreaker.sendWithCircuitBreaker({
          method: 'POST',
          url: 'http://localhost:9091',
          job: 'test-job',
          id: `test-id-${i}`,
          data: `test_metric_${i} 1`
        })
      }
      
      expect(networkCircuitBreaker.requestQueue).toHaveLength(5)
      expect(networkCircuitBreaker.stats.droppedRequests).toBe(1)
      expect(networkCircuitBreaker.requestQueue[0].id).toBe('test-id-1') // First was dropped
    })

    test('should process queued requests when circuit closes', async () => {
      // Queue some requests
      for (let i = 0; i < 3; i++) {
        await networkCircuitBreaker.sendWithCircuitBreaker({
          method: 'POST',
          url: 'http://localhost:9091',
          job: 'test-job',
          id: `test-id-${i}`,
          data: `test_metric_${i} 1`
        })
      }
      
      expect(networkCircuitBreaker.requestQueue).toHaveLength(3)
      
      // Mock successful processing
      mockPushgatewayClient._sendDataDirect.mockResolvedValue('success')
      
      // Close circuit (this would normally happen through _closeCircuit)
      networkCircuitBreaker.state = 'CLOSED'
      
      // Manually trigger queue processing
      await networkCircuitBreaker._processQueuedRequests()
      
      expect(networkCircuitBreaker.requestQueue).toHaveLength(0)
      expect(mockPushgatewayClient._sendDataDirect).toHaveBeenCalledTimes(3)
    })

    test('should retry failed queued requests up to max attempts', async () => {
      // Force circuit to OPEN to queue the request
      networkCircuitBreaker.state = 'OPEN'
      
      // Mock the delay function to avoid waiting
      const originalDelay = networkCircuitBreaker._delay
      networkCircuitBreaker._delay = jest.fn().mockResolvedValue()
      
      // Queue a request
      await networkCircuitBreaker.sendWithCircuitBreaker({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      })
      
      expect(networkCircuitBreaker.requestQueue).toHaveLength(1)
      
      // Mock failing processing and set circuit to CLOSED
      mockPushgatewayClient._sendDataDirect.mockRejectedValue(new Error('Processing failed'))
      networkCircuitBreaker.state = 'CLOSED'
      
      // Process queue multiple times to test retry logic
      await networkCircuitBreaker._processQueuedRequests()
      await networkCircuitBreaker._processQueuedRequests()
      await networkCircuitBreaker._processQueuedRequests()
      await networkCircuitBreaker._processQueuedRequests() // Should drop after max attempts
      
      expect(networkCircuitBreaker.requestQueue).toHaveLength(0)
      expect(networkCircuitBreaker.stats.droppedRequests).toBe(1)
      
      // Restore original method
      networkCircuitBreaker._delay = originalDelay
    })
  })

  describe('network error detection', () => {
    test('should identify network errors correctly', () => {
      const networkErrors = [
        new Error('Network error'),
        new Error('fetch failed'),
        new Error('connection refused'),
        new Error('timeout occurred'),
        new Error('host unreachable'),
        new Error('DNS resolution failed'),
        new Error('net::ERR_NETWORK_CHANGED'),
        new Error('no internet connection'),
        new Error('offline mode')
      ]
      
      const nonNetworkErrors = [
        new Error('400 Bad Request'),
        new Error('401 Unauthorized'),
        new Error('500 Internal Server Error'),
        new Error('Invalid data format'),
        new Error('Quota exceeded')
      ]
      
      networkErrors.forEach(error => {
        expect(networkCircuitBreaker._isNetworkError(error)).toBe(true)
      })
      
      nonNetworkErrors.forEach(error => {
        expect(networkCircuitBreaker._isNetworkError(error)).toBe(false)
      })
    })

    test('should update network connectivity on network errors', async () => {
      mockPushgatewayClient._sendDataDirect.mockRejectedValue(new Error('Network error'))
      
      const requestData = {
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      }
      
      await expect(networkCircuitBreaker.sendWithCircuitBreaker(requestData))
        .rejects.toThrow('Network error')
      
      expect(networkCircuitBreaker.networkConnectivity).toBe(false)
    })
  })

  describe('health monitoring', () => {
    test('should perform health checks at intervals', () => {
      // Health check should be scheduled
      expect(networkCircuitBreaker.healthCheckTimer).toBeDefined()
      
      // Force circuit to OPEN with past failure time
      networkCircuitBreaker.state = 'OPEN'
      networkCircuitBreaker.lastFailureTime = Date.now() - 11000
      
      // Trigger health check
      jest.advanceTimersByTime(5000)
      
      expect(networkCircuitBreaker.state).toBe('HALF_OPEN')
    })

    test('should return correct health status', () => {
      networkCircuitBreaker.state = 'CLOSED'
      networkCircuitBreaker.networkConnectivity = true
      networkCircuitBreaker.lastSuccessfulRequest = Date.now() - 60000 // 1 minute ago
      networkCircuitBreaker.stats.totalRequests = 100
      networkCircuitBreaker.stats.successfulRequests = 95
      
      const health = networkCircuitBreaker.getHealthStatus()
      
      expect(health.isHealthy).toBe(true)
      expect(health.state).toBe('CLOSED')
      expect(health.networkConnectivity).toBe(true)
      expect(health.successRate).toBe(95)
    })

    test('should return unhealthy status when appropriate', () => {
      networkCircuitBreaker.state = 'OPEN'
      networkCircuitBreaker.networkConnectivity = false
      networkCircuitBreaker.lastSuccessfulRequest = Date.now() - 400000 // 6+ minutes ago
      
      const health = networkCircuitBreaker.getHealthStatus()
      
      expect(health.isHealthy).toBe(false)
      expect(health.state).toBe('OPEN')
      expect(health.networkConnectivity).toBe(false)
    })
  })

  describe('statistics', () => {
    test('should track request statistics correctly', async () => {
      // Mock clock to ensure consistent timing
      const originalUpdateAvg = networkCircuitBreaker._updateAverageResponseTime
      networkCircuitBreaker._updateAverageResponseTime = jest.fn()
      
      mockPushgatewayClient._sendDataDirect
        .mockResolvedValueOnce('success')
        .mockResolvedValueOnce('success')
        .mockRejectedValueOnce(new Error('failure'))
      
      const requestData = {
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      }
      
      await networkCircuitBreaker.sendWithCircuitBreaker(requestData)
      await networkCircuitBreaker.sendWithCircuitBreaker(requestData)
      
      try {
        await networkCircuitBreaker.sendWithCircuitBreaker(requestData)
      } catch (error) {
        // Expected failure
      }
      
      const stats = networkCircuitBreaker.getStats()
      
      expect(stats.totalRequests).toBe(3)
      expect(stats.successfulRequests).toBe(2)
      expect(stats.failedRequests).toBe(1)
      expect(networkCircuitBreaker._updateAverageResponseTime).toHaveBeenCalledTimes(3)
      
      // Restore original method
      networkCircuitBreaker._updateAverageResponseTime = originalUpdateAvg
    })

    test('should update average response time correctly', () => {
      // Test exponential moving average calculation
      networkCircuitBreaker._updateAverageResponseTime(100)
      expect(networkCircuitBreaker.stats.avgResponseTime).toBe(100)
      
      networkCircuitBreaker._updateAverageResponseTime(200)
      expect(networkCircuitBreaker.stats.avgResponseTime).toBe(110) // 100 * 0.9 + 200 * 0.1
    })
  })

  describe('manual controls', () => {
    test('should reset circuit breaker manually', () => {
      networkCircuitBreaker.state = 'OPEN'
      networkCircuitBreaker.consecutiveFailures = 5
      networkCircuitBreaker.lastFailureTime = Date.now()
      
      networkCircuitBreaker.reset()
      
      expect(networkCircuitBreaker.state).toBe('CLOSED')
      expect(networkCircuitBreaker.consecutiveFailures).toBe(0)
      expect(networkCircuitBreaker.lastFailureTime).toBeNull()
      expect(networkCircuitBreaker.networkConnectivity).toBe(true)
    })

    test('should open circuit breaker manually', () => {
      networkCircuitBreaker.open()
      
      expect(networkCircuitBreaker.state).toBe('OPEN')
      expect(networkCircuitBreaker.networkConnectivity).toBe(false)
    })

    test('should clear request queue', async () => {
      networkCircuitBreaker.state = 'OPEN'
      
      // Add some requests to queue
      for (let i = 0; i < 3; i++) {
        await networkCircuitBreaker.sendWithCircuitBreaker({
          method: 'POST',
          url: 'http://localhost:9091',
          job: 'test-job',
          id: `test-id-${i}`,
          data: `test_metric_${i} 1`
        })
      }
      
      expect(networkCircuitBreaker.requestQueue).toHaveLength(3)
      
      const cleared = networkCircuitBreaker.clearQueue()
      
      expect(cleared).toBe(3)
      expect(networkCircuitBreaker.requestQueue).toHaveLength(0)
      expect(networkCircuitBreaker.stats.droppedRequests).toBe(3)
    })
  })

  describe('createNetworkCircuitBreaker', () => {
    test('should create circuit breaker with logger', () => {
      const cb = createNetworkCircuitBreaker(mockPushgatewayClient, {}, mockLogger)
      
      expect(cb).toBeInstanceOf(NetworkCircuitBreaker)
      expect(cb.logger).toBe(mockLogger)
      
      cb.destroy()
    })
  })

  describe('integration scenarios', () => {
    test('should handle network outage and recovery', async () => {
      const requestData = {
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      }
      
      // Simulate network outage
      mockPushgatewayClient._sendDataDirect.mockRejectedValue(new Error('Network error'))
      
      // Send requests that will fail and eventually open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await networkCircuitBreaker.sendWithCircuitBreaker(requestData)
        } catch (error) {
          // Expected failures
        }
      }
      
      expect(networkCircuitBreaker.state).toBe('OPEN')
      
      // Subsequent requests should be queued
      const queuedResult = await networkCircuitBreaker.sendWithCircuitBreaker(requestData)
      expect(queuedResult.queued).toBe(true)
      
      // Simulate network recovery
      mockPushgatewayClient._sendDataDirect.mockResolvedValue('success')
      
      // Simulate timeout passing and circuit attempting reset
      networkCircuitBreaker.lastFailureTime = Date.now() - 11000
      
      // Next request should transition to HALF_OPEN and succeed
      const result = await networkCircuitBreaker.sendWithCircuitBreaker(requestData)
      expect(result).toBe('success')
      expect(networkCircuitBreaker.state).toBe('HALF_OPEN')
      
      // Another success should close circuit and process queue
      await networkCircuitBreaker.sendWithCircuitBreaker(requestData)
      expect(networkCircuitBreaker.state).toBe('CLOSED')
    })

    test('should handle high-frequency requests efficiently', async () => {
      mockPushgatewayClient._sendDataDirect.mockResolvedValue('success')
      
      const requests = []
      for (let i = 0; i < 50; i++) {
        requests.push(networkCircuitBreaker.sendWithCircuitBreaker({
          method: 'POST',
          url: 'http://localhost:9091',
          job: 'test-job',
          id: `test-id-${i}`,
          data: `test_metric_${i} 1`
        }))
      }
      
      const results = await Promise.all(requests)
      
      expect(results.every(r => r === 'success')).toBe(true)
      expect(networkCircuitBreaker.stats.totalRequests).toBe(50)
      expect(networkCircuitBreaker.stats.successfulRequests).toBe(50)
    })
  })
})