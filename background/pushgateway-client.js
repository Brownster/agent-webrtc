/**
 * Pushgateway Client Module for WebRTC Stats Exporter
 * Handles HTTP communication with Prometheus Pushgateway including auth, compression, and error handling
 */

/**
 * PushgatewayClient class for sending metrics to Prometheus Pushgateway
 */
class PushgatewayClient {
  constructor () {
    this.requestCount = 0
    this.lastRequestTime = 0
    this.networkCircuitBreaker = null
  }

  /**
   * Set network circuit breaker for enhanced reliability
   * @param {Object} circuitBreaker - Network circuit breaker instance
   */
  setNetworkCircuitBreaker (circuitBreaker) {
    this.networkCircuitBreaker = circuitBreaker
  }

  /**
   * Send data to Pushgateway
   * @param {Object} params - Request parameters
   * @param {string} params.method - HTTP method (POST, DELETE)
   * @param {string} params.url - Pushgateway base URL
   * @param {string} params.job - Job name for metrics
   * @param {string} params.id - Peer connection ID
   * @param {string} [params.username] - Basic auth username
   * @param {string} [params.password] - Basic auth password
   * @param {boolean} [params.gzip=false] - Enable gzip compression
   * @param {string} [params.data] - Metrics data (for POST requests)
   * @param {Function} [params.statsCallback] - Callback for updating statistics
   * @returns {Promise<string>} Response text
   */
  async sendData ({
    method,
    url,
    job,
    id,
    username,
    password,
    gzip = false,
    data,
    statsCallback
  }) {
    // If network circuit breaker is available, use it
    if (this.networkCircuitBreaker) {
      return this.networkCircuitBreaker.sendWithCircuitBreaker({
        method,
        url,
        job,
        id,
        username,
        password,
        gzip,
        data,
        statsCallback
      })
    }

    // Otherwise, use direct sending
    return this._sendDataDirect({
      method,
      url,
      job,
      id,
      username,
      password,
      gzip,
      data,
      statsCallback
    })
  }

  /**
   * Send data directly to Pushgateway (used by circuit breaker or when no circuit breaker is set)
   * @param {Object} params - Request parameters
   * @returns {Promise<string>} Response text
   */
  async _sendDataDirect ({
    method,
    url,
    job,
    id,
    username,
    password,
    gzip = false,
    data,
    statsCallback
  }) {
    this.requestCount++
    const start = Date.now()
    this.lastRequestTime = start

    try {
      // Validate required parameters
      this._validateParams({ method, url, job, id })

      // Build request URL
      const requestUrl = this._buildUrl(url, job, id)

      // Prepare headers
      const headers = this._buildHeaders({ username, password, gzip, data })

      // Compress data if needed
      const requestBody = await this._prepareBody(method, data, gzip)

      // Make the request
      const response = await this._makeRequest(requestUrl, method, headers, requestBody)

      // Handle statistics tracking
      const requestTime = Date.now() - start
      if (statsCallback) {
        await statsCallback({
          success: response.ok,
          requestTime,
          dataSize: requestBody ? requestBody.length : 0,
          hasData: !!data
        })
      }

      // Handle response
      if (!response.ok) {
        const errorText = await response.text()
        throw new PushgatewayError(
          `Pushgateway request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        )
      }

      return await response.text()
    } catch (error) {
      // Handle statistics for errors
      const requestTime = Date.now() - start
      if (statsCallback) {
        await statsCallback({
          success: false,
          requestTime,
          dataSize: data ? data.length : 0,
          hasData: !!data,
          error: error.message
        })
      }
      throw error
    }
  }

  /**
   * Send metrics data (POST request)
   * @param {Object} params - Request parameters
   * @returns {Promise<string>} Response text
   */
  async sendMetrics (params) {
    return this.sendData({ ...params, method: 'POST' })
  }

  /**
   * Delete metrics (DELETE request)
   * @param {Object} params - Request parameters (no data needed)
   * @returns {Promise<string>} Response text
   */
  async deleteMetrics (params) {
    return this.sendData({ ...params, method: 'DELETE', data: undefined })
  }

  /**
   * Get client statistics
   * @returns {Object} Client statistics
   */
  getStats () {
    const stats = {
      requestCount: this.requestCount,
      lastRequestTime: this.lastRequestTime,
      uptime: Date.now() - (this.lastRequestTime || Date.now()),
      hasNetworkCircuitBreaker: !!this.networkCircuitBreaker
    }

    // Add network circuit breaker stats if available
    if (this.networkCircuitBreaker) {
      stats.networkCircuitBreaker = this.networkCircuitBreaker.getStats()
    }

    return stats
  }

  /**
   * Reset client statistics
   */
  resetStats () {
    this.requestCount = 0
    this.lastRequestTime = 0
  }

  // Private methods

  /**
   * Validate required parameters
   * @private
   */
  _validateParams ({ method, url, job, id }) {
    if (!method || !['POST', 'DELETE'].includes(method)) {
      throw new Error('Method must be POST or DELETE')
    }
    if (!url || typeof url !== 'string') {
      throw new Error('URL is required and must be a string')
    }
    if (!job || typeof job !== 'string') {
      throw new Error('Job name is required and must be a string')
    }
    if (!id || typeof id !== 'string') {
      throw new Error('Peer connection ID is required and must be a string')
    }
  }

  /**
   * Build the full request URL
   * @private
   */
  _buildUrl (baseUrl, job, id) {
    // Remove trailing slash from base URL
    const cleanUrl = baseUrl.replace(/\/$/, '')
    
    // Encode URL components to handle special characters
    const encodedJob = encodeURIComponent(job)
    const encodedId = encodeURIComponent(id)
    
    return `${cleanUrl}/metrics/job/${encodedJob}/peerConnectionId/${encodedId}`
  }

  /**
   * Build request headers
   * @private
   */
  _buildHeaders ({ username, password, gzip, data }) {
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded'
    }

    // Add Basic Authentication if credentials provided
    if (username && password) {
      const credentials = btoa(`${username}:${password}`)
      headers.Authorization = `Basic ${credentials}`
    }

    // Add compression header if gzip enabled and data present
    if (data && gzip) {
      headers['Content-Encoding'] = 'gzip'
    }

    return headers
  }

  /**
   * Prepare request body with optional compression
   * @private
   */
  async _prepareBody (method, data, gzip) {
    if (method === 'DELETE' || !data) {
      return undefined
    }

    if (gzip && typeof pako !== 'undefined') {
      try {
        return await pako.gzip(data)
      } catch (error) {
        console.warn('[PushgatewayClient] Gzip compression failed, sending uncompressed:', error)
        return data
      }
    }

    return data
  }

  /**
   * Make the HTTP request
   * @private
   */
  async _makeRequest (url, method, headers, body) {
    const requestOptions = {
      method,
      headers,
      body
    }

    try {
      return await fetch(url, requestOptions)
    } catch (error) {
      throw new PushgatewayError(
        `Network request failed: ${error.message}`,
        0,
        error.message
      )
    }
  }

  /**
   * Create a retry wrapper for resilient requests
   * @param {Object} params - Request parameters
   * @param {number} maxRetries - Maximum number of retries
   * @param {number} baseDelay - Base delay between retries (ms)
   * @returns {Promise<string>} Response text
   */
  async sendDataWithRetry (params, maxRetries = 3, baseDelay = 1000) {
    let lastError

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.sendData(params)
      } catch (error) {
        lastError = error

        // Don't retry on client errors (4xx) or authentication errors
        if (error instanceof PushgatewayError && error.status >= 400 && error.status < 500) {
          throw error
        }

        // Don't retry on the last attempt
        if (attempt === maxRetries) {
          break
        }

        // Calculate delay with exponential backoff
        const delay = baseDelay * Math.pow(2, attempt)
        const jitter = Math.random() * 1000 // Add jitter to prevent thundering herd
        await this._sleep(delay + jitter)
      }
    }

    throw lastError
  }

  /**
   * Sleep for a specified number of milliseconds
   * @private
   */
  _sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/**
 * Custom error class for Pushgateway-specific errors
 */
class PushgatewayError extends Error {
  constructor (message, status = 0, responseText = '') {
    super(message)
    this.name = 'PushgatewayError'
    this.status = status
    this.responseText = responseText
  }
}

/**
 * Utility function to create a default statistics callback
 * @param {Object} storage - Chrome storage reference
 * @returns {Function} Statistics callback function
 */
function createStatsCallback (storage) {
  return async ({ success, requestTime, dataSize, hasData, error }) => {
    try {
      const stats = await storage.local.get([
        'messagesSent',
        'bytesSent',
        'totalTime',
        'errors'
      ])

      if (hasData) {
        stats.messagesSent = (stats.messagesSent || 0) + 1
        stats.bytesSent = (stats.bytesSent || 0) + dataSize
        stats.totalTime = (stats.totalTime || 0) + requestTime
      }

      if (!success) {
        stats.errors = (stats.errors || 0) + 1
      }

      await storage.local.set(stats)
    } catch (storageError) {
      console.warn('[PushgatewayClient] Failed to update statistics:', storageError)
    }
  }
}

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterPushgateway = {
    PushgatewayClient,
    PushgatewayError,
    createStatsCallback
  }
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterPushgateway = {
    PushgatewayClient,
    PushgatewayError,
    createStatsCallback
  }
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterPushgateway = {
    PushgatewayClient,
    PushgatewayError,
    createStatsCallback
  }
}