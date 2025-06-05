/**
 * Unit tests for MessageHandler module
 */

const fs = require('fs')
const path = require('path')

describe('MessageHandler', () => {
  let MessageHandler, MessageHandlerError, createMessageHandler, createAndInitializeMessageHandler
  let mockStatsFormatter, mockConnectionSender, mockLogger, mockChrome
  let handler

  beforeAll(() => {
    // Mock Chrome APIs globally
    global.chrome = {
      runtime: {
        onMessage: {
          addListener: jest.fn()
        }
      },
      tabs: {
        sendMessage: jest.fn(),
        query: jest.fn()
      }
    }

    // Load the message handler module directly
    const modulePath = path.join(__dirname, '../../background/message-handler.js')
    const moduleCode = fs.readFileSync(modulePath, 'utf8')
    
    // Execute the module code
    const moduleFunction = new Function('global', 'globalThis', 'self', 'window', 'console', 'chrome', moduleCode)
    moduleFunction(global, global, global, global, console, global.chrome)
    
    // Get the exported classes
    const exports = global.WebRTCExporterMessageHandler
    MessageHandler = exports.MessageHandler
    MessageHandlerError = exports.MessageHandlerError
    createMessageHandler = exports.createMessageHandler
    createAndInitializeMessageHandler = exports.createAndInitializeMessageHandler
  })

  beforeEach(() => {
    // Reset Chrome API mocks
    jest.clearAllMocks()

    // Mock stats formatter
    mockStatsFormatter = {
      formatStats: jest.fn().mockReturnValue('formatted-data')
    }

    // Mock connection sender
    mockConnectionSender = jest.fn().mockResolvedValue()

    // Mock logger
    mockLogger = {
      log: jest.fn()
    }

    // Mock Chrome APIs
    mockChrome = global.chrome
    mockChrome.tabs.sendMessage.mockResolvedValue({ success: true })
    mockChrome.tabs.query.mockResolvedValue([])

    handler = new MessageHandler(mockStatsFormatter, mockConnectionSender, mockLogger)
  })

  afterEach(() => {
    if (handler) {
      handler.destroy()
    }
  })

  describe('constructor', () => {
    test('should initialize with dependencies', () => {
      expect(handler.statsFormatter).toBe(mockStatsFormatter)
      expect(handler.connectionSender).toBe(mockConnectionSender)
      expect(handler.logger).toBe(mockLogger)
      expect(handler.isInitialized).toBe(false)
      expect(handler.options).toEqual({})
      expect(handler.messageHandlers.size).toBe(0)
    })
  })

  describe('initialize', () => {
    test('should set up message listener successfully', async () => {
      const options = { agentId: 'test-agent' }

      await handler.initialize(options)

      expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledWith(expect.any(Function))
      expect(handler.isInitialized).toBe(true)
      expect(handler.options).toEqual(options)
      expect(handler.messageHandlers.has('peer-connection-stats')).toBe(true)
      expect(mockLogger.log).toHaveBeenCalledWith('MessageHandler initialized successfully with resource tracking')
    })

    test('should not initialize twice', async () => {
      await handler.initialize()
      await handler.initialize()

      expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1)
      expect(mockLogger.log).toHaveBeenCalledWith('MessageHandler already initialized')
    })

    test('should handle initialization errors', async () => {
      const error = new Error('Chrome API error')
      mockChrome.runtime.onMessage.addListener.mockImplementationOnce(() => {
        throw error
      })

      await expect(handler.initialize()).rejects.toThrow(MessageHandlerError)
      expect(handler.isInitialized).toBe(false)
    })
  })

  describe('updateOptions', () => {
    test('should update options', () => {
      const newOptions = { agentId: 'new-agent' }

      handler.updateOptions(newOptions)

      expect(handler.options).toEqual(newOptions)
      expect(mockLogger.log).toHaveBeenCalledWith('MessageHandler options updated')
    })
  })

  describe('handler management', () => {
    test('should register custom handler', () => {
      const customHandler = jest.fn()
      const eventType = 'custom-event'

      handler.registerHandler(eventType, customHandler)

      expect(handler.messageHandlers.get(eventType)).toBe(customHandler)
      expect(mockLogger.log).toHaveBeenCalledWith(`Registered message handler for: ${eventType}`)
    })

    test('should throw error for non-function handler', () => {
      expect(() => handler.registerHandler('test', 'not-a-function'))
        .toThrow('Handler must be a function')
    })

    test('should unregister handler', () => {
      const customHandler = jest.fn()
      const eventType = 'custom-event'

      handler.registerHandler(eventType, customHandler)
      const removed = handler.unregisterHandler(eventType)

      expect(removed).toBe(true)
      expect(handler.messageHandlers.has(eventType)).toBe(false)
      expect(mockLogger.log).toHaveBeenCalledWith(`Unregistered message handler for: ${eventType}`)
    })

    test('should return false when unregistering non-existent handler', () => {
      const removed = handler.unregisterHandler('non-existent')
      expect(removed).toBe(false)
    })
  })

  describe('handlePeerConnectionStats', () => {
    beforeEach(() => {
      handler.options = { agentId: 'test-agent' }
    })

    test('should handle active connection stats', async () => {
      const data = {
        url: 'https://teams.microsoft.com/call/123',
        id: 'conn-1',
        state: 'connected',
        values: { some: 'stats' }
      }

      const result = await handler.handlePeerConnectionStats(data)

      expect(mockStatsFormatter.formatStats).toHaveBeenCalledWith({
        url: data.url,
        state: data.state,
        values: data.values,
        agentId: 'test-agent'
      })
      expect(mockConnectionSender).toHaveBeenCalledWith('POST', 
        { id: 'conn-1', origin: 'https://teams.microsoft.com' }, 
        'formatted-data\n'
      )
      expect(result).toEqual({
        success: true,
        action: 'sent',
        dataLength: 'formatted-data'.length
      })
    })

    test('should handle closed connection', async () => {
      const data = {
        url: 'https://teams.microsoft.com/call/123',
        id: 'conn-1',
        state: 'closed',
        values: {}
      }

      const result = await handler.handlePeerConnectionStats(data)

      expect(mockConnectionSender).toHaveBeenCalledWith('DELETE', 
        { id: 'conn-1', origin: 'https://teams.microsoft.com' }
      )
      expect(result).toEqual({
        success: true,
        action: 'deleted'
      })
      expect(mockStatsFormatter.formatStats).not.toHaveBeenCalled()
    })

    test('should handle empty formatted data', async () => {
      mockStatsFormatter.formatStats.mockReturnValue('')
      
      const data = {
        url: 'https://teams.microsoft.com/call/123',
        id: 'conn-1',
        state: 'connected',
        values: {}
      }

      const result = await handler.handlePeerConnectionStats(data)

      expect(result).toEqual({
        success: true,
        action: 'skipped',
        reason: 'no-data'
      })
      expect(mockConnectionSender).not.toHaveBeenCalled()
    })

    test('should handle connection sender errors', async () => {
      mockConnectionSender.mockRejectedValue(new Error('Network error'))
      
      const data = {
        url: 'https://teams.microsoft.com/call/123',
        id: 'conn-1',
        state: 'connected',
        values: { some: 'stats' }
      }

      await expect(handler.handlePeerConnectionStats(data)).rejects.toThrow(MessageHandlerError)
      expect(mockLogger.log).toHaveBeenCalledWith('Error handling peer connection stats: Network error')
    })

    test('should handle invalid URL', async () => {
      const data = {
        url: 'invalid-url',
        id: 'conn-1',
        state: 'connected',
        values: {}
      }

      await expect(handler.handlePeerConnectionStats(data)).rejects.toThrow(MessageHandlerError)
    })
  })

  describe('tab communication', () => {
    test('should send message to specific tab', async () => {
      const tabId = 1
      const message = { type: 'test' }
      const expectedResponse = { success: true }
      
      mockChrome.tabs.sendMessage.mockResolvedValue(expectedResponse)

      const result = await handler.sendToTab(tabId, message)

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(tabId, message)
      expect(result).toBe(expectedResponse)
    })

    test('should handle tab message errors', async () => {
      const tabId = 1
      const message = { type: 'test' }
      
      mockChrome.tabs.sendMessage.mockRejectedValue(new Error('Tab not found'))

      await expect(handler.sendToTab(tabId, message)).rejects.toThrow(MessageHandlerError)
      expect(mockLogger.log).toHaveBeenCalledWith('Error sending message to tab 1: Tab not found')
    })

    test('should broadcast message to all tabs', async () => {
      const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }]
      const message = { type: 'broadcast' }
      
      mockChrome.tabs.query.mockResolvedValue(tabs)
      mockChrome.tabs.sendMessage
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('Tab error'))
        .mockResolvedValueOnce({ data: 'response' })

      const results = await handler.broadcastToTabs(message)

      expect(mockChrome.tabs.query).toHaveBeenCalledWith({})
      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledTimes(3)
      expect(results).toHaveLength(3)
      expect(results[0]).toEqual({ tabId: 1, success: true, response: { success: true } })
      expect(results[1]).toEqual({ tabId: 2, success: false, response: expect.any(Error) })
      expect(results[2]).toEqual({ tabId: 3, success: true, response: { data: 'response' } })
    })

    test('should handle broadcast query errors', async () => {
      mockChrome.tabs.query.mockRejectedValue(new Error('Query failed'))

      await expect(handler.broadcastToTabs({})).rejects.toThrow(MessageHandlerError)
    })
  })

  describe('message handling', () => {
    beforeEach(async () => {
      await handler.initialize({ agentId: 'test-agent' })
    })

    test('should handle valid peer-connection-stats message', async () => {
      const messageListener = mockChrome.runtime.onMessage.addListener.mock.calls[0][0]
      const sendResponse = jest.fn()
      const message = {
        event: 'peer-connection-stats',
        data: {
          url: 'https://teams.microsoft.com/call/123',
          id: 'conn-1',
          state: 'connected',
          values: { some: 'stats' }
        }
      }

      await messageListener(message, {}, sendResponse)

      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        action: 'sent',
        dataLength: 'formatted-data'.length
      })
    })

    test('should handle invalid message format', async () => {
      const messageListener = mockChrome.runtime.onMessage.addListener.mock.calls[0][0]
      const sendResponse = jest.fn()

      await messageListener(null, {}, sendResponse)
      expect(sendResponse).toHaveBeenCalledWith({ error: 'Invalid message format' })

      await messageListener('string', {}, sendResponse)
      expect(sendResponse).toHaveBeenCalledWith({ error: 'Invalid message format' })
    })

    test('should handle missing event type', async () => {
      const messageListener = mockChrome.runtime.onMessage.addListener.mock.calls[0][0]
      const sendResponse = jest.fn()
      const message = { data: {} }

      await messageListener(message, {}, sendResponse)

      expect(sendResponse).toHaveBeenCalledWith({ error: 'Missing event type' })
    })

    test('should handle unknown event type', async () => {
      const messageListener = mockChrome.runtime.onMessage.addListener.mock.calls[0][0]
      const sendResponse = jest.fn()
      const message = { event: 'unknown-event', data: {} }

      await messageListener(message, {}, sendResponse)

      expect(sendResponse).toHaveBeenCalledWith({ error: 'Unknown event type' })
      expect(mockLogger.log).toHaveBeenCalledWith('No handler registered for event: unknown-event')
    })

    test('should handle handler errors', async () => {
      const errorHandler = jest.fn().mockRejectedValue(new Error('Handler error'))
      handler.registerHandler('error-event', errorHandler)

      const messageListener = mockChrome.runtime.onMessage.addListener.mock.calls[0][0]
      const sendResponse = jest.fn()
      const message = { event: 'error-event', data: {} }

      await messageListener(message, {}, sendResponse)

      expect(sendResponse).toHaveBeenCalledWith({ error: 'Handler error' })
      expect(mockLogger.log).toHaveBeenCalledWith('Message handler error: Handler error')
    })

    test('should handle custom message types', async () => {
      const customHandler = jest.fn().mockResolvedValue({ customResult: true })
      handler.registerHandler('custom-event', customHandler)

      const messageListener = mockChrome.runtime.onMessage.addListener.mock.calls[0][0]
      const sendResponse = jest.fn()
      const message = { event: 'custom-event', data: { test: 'data' } }
      const sender = { tab: { id: 1 } }

      await messageListener(message, sender, sendResponse)

      expect(customHandler).toHaveBeenCalledWith({ test: 'data' }, sender)
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        customResult: true
      })
    })
  })

  describe('getStats', () => {
    test('should return handler statistics', () => {
      handler.registerHandler('handler1', jest.fn())
      handler.registerHandler('handler2', jest.fn())

      const stats = handler.getStats()

      expect(stats).toEqual({
        isInitialized: false,
        registeredHandlers: ['handler1', 'handler2'],
        handlerCount: 2
      })
    })
  })

  describe('destroy', () => {
    test('should clean up resources', () => {
      handler.registerHandler('test', jest.fn())
      handler.options = { test: true }
      handler.isInitialized = true

      handler.destroy()

      expect(handler.messageHandlers.size).toBe(0)
      expect(handler.isInitialized).toBe(false)
      expect(handler.options).toEqual({})
      expect(handler.messageListener).toBeNull()
      expect(mockLogger.log).toHaveBeenCalledWith('MessageHandler destroyed (no resource tracker available)')
    })
  })

  describe('MessageHandlerError', () => {
    test('should create custom error', () => {
      const error = new MessageHandlerError('Test error message')
      
      expect(error.name).toBe('MessageHandlerError')
      expect(error.message).toBe('Test error message')
      expect(error instanceof Error).toBe(true)
    })
  })

  describe('createMessageHandler', () => {
    test('should create handler with dependencies', () => {
      const handler = createMessageHandler({
        statsFormatter: mockStatsFormatter,
        connectionSender: mockConnectionSender,
        logger: mockLogger
      })

      expect(handler).toBeInstanceOf(MessageHandler)
      expect(handler.statsFormatter).toBe(mockStatsFormatter)
      expect(handler.connectionSender).toBe(mockConnectionSender)
      expect(handler.logger).toBe(mockLogger)
    })
  })

  describe('createAndInitializeMessageHandler', () => {
    test('should create and initialize handler', async () => {
      const options = { agentId: 'test-agent' }
      
      const handler = await createAndInitializeMessageHandler({
        statsFormatter: mockStatsFormatter,
        connectionSender: mockConnectionSender,
        logger: mockLogger
      }, options)

      expect(handler).toBeInstanceOf(MessageHandler)
      expect(handler.isInitialized).toBe(true)
      expect(handler.options).toEqual(options)

      handler.destroy()
    })

    test('should work without initial options', async () => {
      const handler = await createAndInitializeMessageHandler({
        statsFormatter: mockStatsFormatter,
        connectionSender: mockConnectionSender,
        logger: mockLogger
      })

      expect(handler.isInitialized).toBe(true)
      expect(handler.options).toEqual({})

      handler.destroy()
    })
  })
})
