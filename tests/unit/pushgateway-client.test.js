/**
 * Unit tests for PushgatewayClient module
 */

const fs = require('fs')
const path = require('path')

describe('PushgatewayClient', () => {
  let PushgatewayClient, PushgatewayError, createStatsCallback
  let client
  let mockFetch
  let mockPako

  beforeAll(() => {
    // Load the pushgateway client module directly
    const modulePath = path.join(__dirname, '../../background/pushgateway-client.js')
    const moduleCode = fs.readFileSync(modulePath, 'utf8')
    
    // Mock pako for compression tests
    global.pako = {
      gzip: jest.fn()
    }
    mockPako = global.pako

    // Mock fetch globally
    global.fetch = jest.fn()
    mockFetch = global.fetch

    // Mock btoa for Basic Auth
    global.btoa = jest.fn((str) => Buffer.from(str).toString('base64'))

    // Execute the module code
    const moduleFunction = new Function('global', 'globalThis', 'self', 'window', 'console', 'pako', 'fetch', 'btoa', moduleCode)
    moduleFunction(global, global, global, global, console, mockPako, mockFetch, global.btoa)
    
    // Get the exported classes
    const exports = global.WebRTCExporterPushgateway
    PushgatewayClient = exports.PushgatewayClient
    PushgatewayError = exports.PushgatewayError
    createStatsCallback = exports.createStatsCallback
  })

  beforeEach(() => {
    client = new PushgatewayClient()
    jest.clearAllMocks()
  })

  describe('constructor', () => {
    test('should initialize with default values', () => {
      expect(client.requestCount).toBe(0)
      expect(client.lastRequestTime).toBe(0)
    })
  })

  describe('sendData', () => {
    test('should send POST request successfully', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('Success')
      }
      mockFetch.mockResolvedValue(mockResponse)

      const result = await client.sendData({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:9091/metrics/job/test-job/peerConnectionId/test-id',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: 'test_metric 1'
        }
      )
      expect(result).toBe('Success')
      expect(client.requestCount).toBe(1)
    })

    test('should send DELETE request successfully', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('')
      }
      mockFetch.mockResolvedValue(mockResponse)

      const result = await client.sendData({
        method: 'DELETE',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id'
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:9091/metrics/job/test-job/peerConnectionId/test-id',
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: undefined
        }
      )
      expect(result).toBe('')
    })

    test('should add Basic Authentication headers', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('Success')
      }
      mockFetch.mockResolvedValue(mockResponse)

      await client.sendData({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        username: 'user',
        password: 'pass',
        data: 'test_metric 1'
      })

      expect(global.btoa).toHaveBeenCalledWith('user:pass')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Basic dXNlcjpwYXNz'
          })
        })
      )
    })

    test('should use proxy when enabled', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('Success')
      }
      mockFetch.mockResolvedValue(mockResponse)

      await client.sendData({
        method: 'POST',
        useProxy: true,
        proxyUrl: 'https://proxy.example.com/metrics/job/{job}/id/{id}',
        apiKey: 'secret',
        job: 'test-job',
        id: 'test-id',
        username: 'ignored',
        password: 'ignored',
        data: 'metric 1'
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://proxy.example.com/metrics/job/test-job/id/test-id',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'secret'
          })
        })
      )
      const callHeaders = mockFetch.mock.calls[0][1].headers
      expect(callHeaders.Authorization).toBeUndefined()
    })

    test('should require proxyUrl when useProxy is true', async () => {
      await expect(client.sendData({
        method: 'POST',
        useProxy: true,
        job: 'test-job',
        id: '1',
        data: 'x'
      })).rejects.toThrow('Proxy URL is required when useProxy is true')
    })

    test('should handle gzip compression', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('Success')
      }
      mockFetch.mockResolvedValue(mockResponse)
      mockPako.gzip.mockResolvedValue(new Uint8Array([1, 2, 3]))

      await client.sendData({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1',
        gzip: true
      })

      expect(mockPako.gzip).toHaveBeenCalledWith('test_metric 1')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Encoding': 'gzip'
          }),
          body: new Uint8Array([1, 2, 3])
        })
      )
    })

    test('should handle gzip compression failure gracefully', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('Success')
      }
      mockFetch.mockResolvedValue(mockResponse)
      mockPako.gzip.mockRejectedValue(new Error('Compression failed'))

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      await client.sendData({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1',
        gzip: true
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        '[PushgatewayClient] Gzip compression failed, sending uncompressed:',
        expect.any(Error)
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: 'test_metric 1' // Uncompressed fallback
        })
      )

      consoleSpy.mockRestore()
    })

    test('should call stats callback on success', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('Success')
      }
      mockFetch.mockResolvedValue(mockResponse)
      const mockStatsCallback = jest.fn()

      await client.sendData({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1',
        statsCallback: mockStatsCallback
      })

      expect(mockStatsCallback).toHaveBeenCalledWith({
        success: true,
        requestTime: expect.any(Number),
        dataSize: expect.any(Number),
        hasData: true
      })
    })

    test('should call stats callback on error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))
      const mockStatsCallback = jest.fn()

      await expect(client.sendData({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1',
        statsCallback: mockStatsCallback
      })).rejects.toThrow()

      expect(mockStatsCallback).toHaveBeenCalledWith({
        success: false,
        requestTime: expect.any(Number),
        dataSize: expect.any(Number),
        hasData: true,
        error: expect.any(String)
      })
    })

    test('should throw PushgatewayError on HTTP error response', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn().mockResolvedValue('Invalid metrics format')
      }
      mockFetch.mockResolvedValue(mockResponse)

      await expect(client.sendData({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'invalid_metric'
      })).rejects.toThrow(PushgatewayError)
    })

    test('should validate required parameters', async () => {
      await expect(client.sendData({
        // Missing method
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id'
      })).rejects.toThrow('Method must be POST or DELETE')

      await expect(client.sendData({
        method: 'POST',
        // Missing url
        job: 'test-job',
        id: 'test-id'
      })).rejects.toThrow('URL is required and must be a string')

      await expect(client.sendData({
        method: 'POST',
        url: 'http://localhost:9091',
        // Missing job
        id: 'test-id'
      })).rejects.toThrow('Job name is required and must be a string')

      await expect(client.sendData({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job'
        // Missing id
      })).rejects.toThrow('Peer connection ID is required and must be a string')
    })

    test('should handle URL encoding for special characters', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('Success')
      }
      mockFetch.mockResolvedValue(mockResponse)

      await client.sendData({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test job/with spaces',
        id: 'test-id@special',
        data: 'test_metric 1'
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:9091/metrics/job/test%20job%2Fwith%20spaces/peerConnectionId/test-id%40special',
        expect.any(Object)
      )
    })
  })

  describe('sendMetrics', () => {
    test('should call sendData with POST method', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('Success')
      }
      mockFetch.mockResolvedValue(mockResponse)

      const result = await client.sendMetrics({
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST'
        })
      )
      expect(result).toBe('Success')
    })
  })

  describe('deleteMetrics', () => {
    test('should call sendData with DELETE method and no data', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('')
      }
      mockFetch.mockResolvedValue(mockResponse)

      const result = await client.deleteMetrics({
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id'
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'DELETE',
          body: undefined
        })
      )
      expect(result).toBe('')
    })
  })

  describe('getStats', () => {
    test('should return client statistics', () => {
      const stats = client.getStats()
      expect(stats).toHaveProperty('requestCount', 0)
      expect(stats).toHaveProperty('lastRequestTime', 0)
      expect(stats).toHaveProperty('uptime')
    })

    test('should update statistics after requests', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('Success')
      }
      mockFetch.mockResolvedValue(mockResponse)

      await client.sendData({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      })

      const stats = client.getStats()
      expect(stats.requestCount).toBe(1)
      expect(stats.lastRequestTime).toBeGreaterThan(0)
    })
  })

  describe('resetStats', () => {
    test('should reset statistics to initial values', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('Success')
      }
      mockFetch.mockResolvedValue(mockResponse)

      await client.sendData({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      })

      expect(client.getStats().requestCount).toBe(1)

      client.resetStats()

      const stats = client.getStats()
      expect(stats.requestCount).toBe(0)
      expect(stats.lastRequestTime).toBe(0)
    })
  })

  describe('sendDataWithRetry', () => {
    test('should succeed on first attempt', async () => {
      const mockResponse = {
        ok: true,
        text: jest.fn().mockResolvedValue('Success')
      }
      mockFetch.mockResolvedValue(mockResponse)

      const result = await client.sendDataWithRetry({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(result).toBe('Success')
    })

    test('should retry on network failure and eventually succeed', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('Success')
        })

      const result = await client.sendDataWithRetry({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      }, 3, 10) // Small delay for testing

      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(result).toBe('Success')
    })

    test('should not retry on 4xx client errors', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn().mockResolvedValue('Invalid data')
      }
      mockFetch.mockResolvedValue(mockResponse)

      await expect(client.sendDataWithRetry({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'invalid_metric'
      })).rejects.toThrow(PushgatewayError)

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    test('should exhaust retries and throw last error', async () => {
      mockFetch.mockRejectedValue(new Error('Persistent network error'))

      await expect(client.sendDataWithRetry({
        method: 'POST',
        url: 'http://localhost:9091',
        job: 'test-job',
        id: 'test-id',
        data: 'test_metric 1'
      }, 2, 10)).rejects.toThrow('Persistent network error')

      expect(mockFetch).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })
  })

  describe('PushgatewayError', () => {
    test('should create error with status and response text', () => {
      const error = new PushgatewayError('Test error', 500, 'Internal server error')
      
      expect(error.name).toBe('PushgatewayError')
      expect(error.message).toBe('Test error')
      expect(error.status).toBe(500)
      expect(error.responseText).toBe('Internal server error')
    })

    test('should have default values for optional parameters', () => {
      const error = new PushgatewayError('Test error')
      
      expect(error.status).toBe(0)
      expect(error.responseText).toBe('')
    })
  })

  describe('createStatsCallback', () => {
    test('should create a functioning stats callback', async () => {
      const mockStorage = {
        local: {
          get: jest.fn().mockResolvedValue({
            messagesSent: 5,
            bytesSent: 1000,
            totalTime: 500,
            errors: 1
          }),
          set: jest.fn().mockResolvedValue()
        }
      }

      const callback = createStatsCallback(mockStorage)

      await callback({
        success: true,
        requestTime: 100,
        dataSize: 200,
        hasData: true
      })

      expect(mockStorage.local.get).toHaveBeenCalledWith([
        'messagesSent',
        'bytesSent',
        'totalTime',
        'errors'
      ])

      expect(mockStorage.local.set).toHaveBeenCalledWith({
        messagesSent: 6,
        bytesSent: 1200,
        totalTime: 600,
        errors: 1
      })
    })

    test('should handle storage errors gracefully', async () => {
      const mockStorage = {
        local: {
          get: jest.fn().mockRejectedValue(new Error('Storage error')),
          set: jest.fn()
        }
      }

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      const callback = createStatsCallback(mockStorage)

      await callback({
        success: true,
        requestTime: 100,
        dataSize: 200,
        hasData: true
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        '[PushgatewayClient] Failed to update statistics:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })
  })
})
