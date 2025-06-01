/**
 * Network Circuit Breaker for WebRTC Stats Exporter
 * Prevents network failure cascades while maintaining metric delivery through queuing
 */

/**
 * Network Circuit Breaker class specifically designed for HTTP requests to Pushgateway
 * Extends the basic circuit breaker pattern with request queuing and network health monitoring
 */
class NetworkCircuitBreaker {
  constructor (pushgatewayClient, options = {}) {
    this.client = pushgatewayClient
    this.failureThreshold = options.failureThreshold || 5
    this.resetTimeout = options.resetTimeout || 60000 // 1 minute
    this.healthCheckInterval = options.healthCheckInterval || 30000 // 30 seconds
    this.maxQueueSize = options.maxQueueSize || 100
    this.maxRetryAttempts = options.maxRetryAttempts || 3
    
    // Circuit breaker state
    this.consecutiveFailures = 0
    this.state = 'CLOSED' // CLOSED, OPEN, HALF_OPEN
    this.lastFailureTime = null
    this.successCount = 0
    
    // Request queue for when circuit is open
    this.requestQueue = []
    this.isProcessingQueue = false
    
    // Health monitoring
    this.healthCheckTimer = null
    this.lastSuccessfulRequest = Date.now()
    this.networkConnectivity = true
    
    // Statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      queuedRequests: 0,
      droppedRequests: 0,
      avgResponseTime: 0,
      lastResponseTime: 0
    }
    
    this.logger = null
    this._initializeHealthCheck()
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
      this.logger.log('[NetworkCircuitBreaker]', ...args)
    }
  }

  /**
   * Send data through the network circuit breaker
   * @param {Object} requestData - Request data for pushgateway client
   * @returns {Promise<any>} Response from pushgateway or queued confirmation
   */
  async sendWithCircuitBreaker (requestData) {
    this.stats.totalRequests++
    
    if (this.state === 'OPEN') {
      // Check if we should attempt to transition to HALF_OPEN
      if (this._shouldAttemptReset()) {
        this.state = 'HALF_OPEN'
        this.successCount = 0
        this.log('Circuit breaker transitioning to HALF_OPEN for health check')
      } else {
        this.log(`Circuit breaker is OPEN, queueing request for ${requestData.id}`)
        return this.queueRequest(requestData)
      }
    }
    
    const startTime = Date.now()
    
    try {
      const result = await this._executeRequest(requestData)
      const responseTime = Date.now() - startTime
      
      this._onSuccess(responseTime)
      return result
    } catch (error) {
      const responseTime = Date.now() - startTime
      this._onFailure(error, responseTime)
      throw error
    }
  }

  /**
   * Queue a request for later processing when network recovers
   * @param {Object} requestData - Request data to queue
   * @returns {Promise<Object>} Queued confirmation
   * @private
   */
  async queueRequest (requestData) {
    if (this.requestQueue.length >= this.maxQueueSize) {
      // Drop oldest requests to prevent memory bloat
      const dropped = this.requestQueue.shift()
      this.stats.droppedRequests++
      this.log(`Dropped oldest queued request for ${dropped.id} due to queue limit`)
    }
    
    const queuedRequest = {
      ...requestData,
      queuedAt: Date.now(),
      attempts: 0
    }
    
    this.requestQueue.push(queuedRequest)
    this.stats.queuedRequests++
    
    this.log(`Queued request for ${requestData.id}, queue size: ${this.requestQueue.length}`)
    
    return {
      queued: true,
      queuePosition: this.requestQueue.length,
      estimatedDelay: this._estimateProcessingDelay()
    }
  }

  /**
   * Process queued requests when circuit is back to CLOSED
   * @private
   */
  async _processQueuedRequests () {
    if (this.isProcessingQueue || this.state !== 'CLOSED' || this.requestQueue.length === 0) {
      return
    }
    
    this.isProcessingQueue = true
    this.log(`Processing ${this.requestQueue.length} queued requests`)
    
    const maxConcurrent = 3
    let processed = 0
    let successful = 0
    let failed = 0
    
    while (this.requestQueue.length > 0 && this.state === 'CLOSED') {
      const batch = this.requestQueue.splice(0, maxConcurrent)
      
      const results = await Promise.allSettled(
        batch.map(queuedRequest => this._processQueuedRequest(queuedRequest))
      )
      
      results.forEach((result, index) => {
        processed++
        if (result.status === 'fulfilled') {
          successful++
        } else {
          failed++
          // If individual request failed, put it back in queue with higher attempts
          const failedRequest = batch[index]
          failedRequest.attempts++
          
          if (failedRequest.attempts < this.maxRetryAttempts) {
            this.requestQueue.unshift(failedRequest) // Put back at front
          } else {
            this.stats.droppedRequests++
            this.log(`Dropped request for ${failedRequest.id} after ${failedRequest.attempts} attempts`)
          }
        }
      })
      
      // Add delay between batches to avoid overwhelming the server
      if (this.requestQueue.length > 0) {
        await this._delay(1000)
      }
    }
    
    this.isProcessingQueue = false
    this.log(`Queue processing complete: ${successful} successful, ${failed} failed, ${this.requestQueue.length} remaining`)
  }

  /**
   * Process a single queued request
   * @param {Object} queuedRequest - Queued request data
   * @returns {Promise<any>} Request result
   * @private
   */
  async _processQueuedRequest (queuedRequest) {
    const { queuedAt, attempts, ...requestData } = queuedRequest
    const queueTime = Date.now() - queuedAt
    
    this.log(`Processing queued request for ${requestData.id} (queued ${queueTime}ms ago, attempt ${attempts + 1})`)
    
    try {
      const result = await this._executeRequest(requestData)
      this.log(`Successfully processed queued request for ${requestData.id}`)
      return result
    } catch (error) {
      this.log(`Failed to process queued request for ${requestData.id}: ${error.message}`)
      throw error
    }
  }

  /**
   * Execute the actual request through the pushgateway client
   * @param {Object} requestData - Request data
   * @returns {Promise<any>} Request result
   * @private
   */
  async _executeRequest (requestData) {
    // Use _sendDataDirect to avoid circuit breaker recursion
    return await this.client._sendDataDirect(requestData)
  }

  /**
   * Handle successful request
   * @param {number} responseTime - Response time in milliseconds
   * @private
   */
  _onSuccess (responseTime) {
    this.consecutiveFailures = 0
    this.lastSuccessfulRequest = Date.now()
    this.stats.successfulRequests++
    this.stats.lastResponseTime = responseTime
    this._updateAverageResponseTime(responseTime)
    
    if (this.state === 'HALF_OPEN') {
      this.successCount++
      if (this.successCount >= 2) {
        this._closeCircuit()
      }
    }
  }

  /**
   * Handle failed request
   * @param {Error} error - The error that occurred
   * @param {number} responseTime - Response time in milliseconds
   * @private
   */
  _onFailure (error, responseTime) {
    this.consecutiveFailures++
    this.lastFailureTime = Date.now()
    this.stats.failedRequests++
    this.stats.lastResponseTime = responseTime
    this._updateAverageResponseTime(responseTime)
    
    // Check if error indicates network connectivity issues
    if (this._isNetworkError(error)) {
      this.networkConnectivity = false
    }
    
    if (this.state === 'HALF_OPEN') {
      this._openCircuit()
      this.log(`Circuit reopened due to failure in HALF_OPEN: ${error.message}`)
    } else if (this.state === 'CLOSED' && this.consecutiveFailures >= this.failureThreshold) {
      this._openCircuit()
      this.log(`Circuit opened after ${this.consecutiveFailures} consecutive failures: ${error.message}`)
    }
  }

  /**
   * Open the circuit breaker
   * @private
   */
  _openCircuit () {
    this.state = 'OPEN'
    this.successCount = 0
    this.networkConnectivity = false
    this.log('Network circuit breaker OPENED - requests will be queued')
  }

  /**
   * Close the circuit breaker and process queued requests
   * @private
   */
  _closeCircuit () {
    this.state = 'CLOSED'
    this.consecutiveFailures = 0
    this.successCount = 0
    this.lastFailureTime = null
    this.networkConnectivity = true
    this.log('Network circuit breaker CLOSED - processing queued requests')
    
    // Process queued requests asynchronously
    setTimeout(() => this._processQueuedRequests(), 100)
  }

  /**
   * Check if error indicates network connectivity issues
   * @param {Error} error - Error to check
   * @returns {boolean} True if error is network-related
   * @private
   */
  _isNetworkError (error) {
    const message = error.message.toLowerCase()
    const networkErrorPatterns = [
      'network error',
      'fetch failed',
      'connection refused',
      'timeout',
      'unreachable',
      'dns',
      'net::err_',
      'no internet',
      'offline'
    ]
    
    return networkErrorPatterns.some(pattern => message.includes(pattern))
  }

  /**
   * Update average response time with exponential moving average
   * @param {number} responseTime - Latest response time
   * @private
   */
  _updateAverageResponseTime (responseTime) {
    if (this.stats.avgResponseTime === 0) {
      this.stats.avgResponseTime = responseTime
    } else {
      // Exponential moving average with alpha = 0.1
      this.stats.avgResponseTime = (0.1 * responseTime) + (0.9 * this.stats.avgResponseTime)
    }
  }

  /**
   * Estimate processing delay for queued requests
   * @returns {number} Estimated delay in milliseconds
   * @private
   */
  _estimateProcessingDelay () {
    const queueSize = this.requestQueue.length
    const avgResponseTime = Math.max(this.stats.avgResponseTime, 100) // Minimum 100ms
    const batchSize = 3
    const batchDelay = 1000 // 1 second between batches
    
    const batches = Math.ceil(queueSize / batchSize)
    return (batches * avgResponseTime) + ((batches - 1) * batchDelay)
  }

  /**
   * Initialize health check monitoring
   * @private
   */
  _initializeHealthCheck () {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
    }
    
    this.healthCheckTimer = setInterval(() => {
      this._performHealthCheck()
    }, this.healthCheckInterval)
  }

  /**
   * Perform health check to potentially transition from OPEN to HALF_OPEN
   * @private
   */
  _performHealthCheck () {
    if (this.state === 'OPEN' && this._shouldAttemptReset()) {
      this.state = 'HALF_OPEN'
      this.successCount = 0
      this.log('Circuit breaker transitioning to HALF_OPEN for health check')
    }
  }

  /**
   * Check if circuit breaker should attempt reset
   * @returns {boolean} True if reset should be attempted
   * @private
   */
  _shouldAttemptReset () {
    return this.lastFailureTime && 
           (Date.now() - this.lastFailureTime) >= this.resetTimeout
  }

  /**
   * Delay for specified milliseconds
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   * @private
   */
  _delay (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Get network circuit breaker statistics
   * @returns {Object} Circuit breaker statistics
   */
  getStats () {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: this.failureThreshold,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessfulRequest: this.lastSuccessfulRequest,
      networkConnectivity: this.networkConnectivity,
      queueSize: this.requestQueue.length,
      maxQueueSize: this.maxQueueSize,
      isProcessingQueue: this.isProcessingQueue,
      resetTimeout: this.resetTimeout,
      timeUntilReset: this.lastFailureTime ? 
        Math.max(0, this.resetTimeout - (Date.now() - this.lastFailureTime)) : 0,
      ...this.stats
    }
  }

  /**
   * Get health status of the network circuit breaker
   * @returns {Object} Health status information
   */
  getHealthStatus () {
    const now = Date.now()
    const timeSinceLastSuccess = now - this.lastSuccessfulRequest
    const isHealthy = this.state === 'CLOSED' && 
                     this.networkConnectivity && 
                     timeSinceLastSuccess < 300000 // 5 minutes
    
    return {
      isHealthy,
      state: this.state,
      networkConnectivity: this.networkConnectivity,
      timeSinceLastSuccess,
      queueSize: this.requestQueue.length,
      successRate: this.stats.totalRequests > 0 ? 
        (this.stats.successfulRequests / this.stats.totalRequests) * 100 : 100,
      avgResponseTime: Math.round(this.stats.avgResponseTime)
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  reset () {
    this.state = 'CLOSED'
    this.consecutiveFailures = 0
    this.successCount = 0
    this.lastFailureTime = null
    this.networkConnectivity = true
    this.log('Network circuit breaker manually reset to CLOSED state')
    
    // Process any queued requests
    setTimeout(() => this._processQueuedRequests(), 100)
  }

  /**
   * Manually open the circuit breaker
   */
  open () {
    this._openCircuit()
    this.log('Network circuit breaker manually opened')
  }

  /**
   * Clear the request queue
   * @returns {number} Number of requests cleared
   */
  clearQueue () {
    const cleared = this.requestQueue.length
    this.requestQueue = []
    this.stats.droppedRequests += cleared
    this.log(`Cleared ${cleared} queued requests`)
    return cleared
  }

  /**
   * Destroy the circuit breaker and clean up resources
   */
  destroy () {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
    
    const queuedCount = this.requestQueue.length
    this.requestQueue = []
    
    this.log(`Network circuit breaker destroyed, cleared ${queuedCount} queued requests`)
  }
}

/**
 * Create a pre-configured NetworkCircuitBreaker instance
 * @param {Object} pushgatewayClient - Pushgateway client instance
 * @param {Object} options - Configuration options
 * @param {Object} logger - Logger instance (optional)
 * @returns {NetworkCircuitBreaker} Configured network circuit breaker
 */
function createNetworkCircuitBreaker (pushgatewayClient, options = {}, logger = null) {
  const circuitBreaker = new NetworkCircuitBreaker(pushgatewayClient, options)
  if (logger) {
    circuitBreaker.setLogger(logger)
  }
  return circuitBreaker
}

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterNetworkCircuitBreaker = {
    NetworkCircuitBreaker,
    createNetworkCircuitBreaker
  }
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterNetworkCircuitBreaker = {
    NetworkCircuitBreaker,
    createNetworkCircuitBreaker
  }
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterNetworkCircuitBreaker = {
    NetworkCircuitBreaker,
    createNetworkCircuitBreaker
  }
}