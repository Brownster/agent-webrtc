/**
 * Unit tests for TabMonitor module
 */

const fs = require('fs')
const path = require('path')

describe('TabMonitor', () => {
  let TabMonitor, TabMonitorError, createTabMonitor, createAndInitializeTabMonitor
  let mockDomainManager, mockConnectionTracker, mockLogger, mockChrome
  let monitor

  beforeAll(() => {
    // Mock Chrome APIs globally
    global.chrome = {
      tabs: {
        onActivated: {
          addListener: jest.fn()
        },
        onUpdated: {
          addListener: jest.fn()
        },
        get: jest.fn(),
        query: jest.fn()
      },
      action: {
        setTitle: jest.fn(),
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn()
      }
    }

    // Load the tab monitor module directly
    const modulePath = path.join(__dirname, '../../background/tab-monitor.js')
    const moduleCode = fs.readFileSync(modulePath, 'utf8')
    
    // Execute the module code
    const moduleFunction = new Function('global', 'globalThis', 'self', 'window', 'console', 'chrome', moduleCode)
    moduleFunction(global, global, global, global, console, global.chrome)
    
    // Get the exported classes
    const exports = global.WebRTCExporterTabMonitor
    TabMonitor = exports.TabMonitor
    TabMonitorError = exports.TabMonitorError
    createTabMonitor = exports.createTabMonitor
    createAndInitializeTabMonitor = exports.createAndInitializeTabMonitor
  })

  beforeEach(() => {
    // Reset Chrome API mocks
    jest.clearAllMocks()

    // Mock domain manager
    mockDomainManager = {
      extractOrigin: jest.fn(),
      isTargetDomain: jest.fn(),
      shouldAutoEnable: jest.fn()
    }

    // Mock connection tracker
    mockConnectionTracker = {
      getConnectionStats: jest.fn().mockResolvedValue({
        originCounts: {},
        totalConnections: 0
      })
    }

    // Mock logger
    mockLogger = {
      log: jest.fn()
    }

    // Mock Chrome APIs
    mockChrome = global.chrome
    mockChrome.tabs.get.mockResolvedValue({ id: 1, url: 'https://example.com' })
    mockChrome.tabs.query.mockResolvedValue([])
    mockChrome.action.setTitle.mockResolvedValue()
    mockChrome.action.setBadgeText.mockResolvedValue()
    mockChrome.action.setBadgeBackgroundColor.mockResolvedValue()

    monitor = new TabMonitor(mockDomainManager, mockConnectionTracker, mockLogger)
  })

  afterEach(() => {
    if (monitor) {
      monitor.destroy()
    }
  })

  describe('constructor', () => {
    test('should initialize with dependencies', () => {
      expect(monitor.domainManager).toBe(mockDomainManager)
      expect(monitor.connectionTracker).toBe(mockConnectionTracker)
      expect(monitor.logger).toBe(mockLogger)
      expect(monitor.isInitialized).toBe(false)
      expect(monitor.options).toEqual({})
    })

    test('should have default badge configuration', () => {
      expect(monitor.badgeConfig).toEqual({
        enabledColor: 'rgb(63, 81, 181)',
        textEmpty: '',
        titles: {
          noValidPage: 'WebRTC Internals Exporter (no valid page)',
          base: 'WebRTC Internals Exporter',
          activeConnections: 'WebRTC Internals Exporter\nActive Peer Connections',
          disabled: '(disabled)',
          unsupportedDomain: '(unsupported domain)'
        }
      })
    })
  })

  describe('initialize', () => {
    test('should set up event listeners successfully', async () => {
      const options = { enabledOrigins: { 'example.com': true } }

      await monitor.initialize(options)

      expect(mockChrome.tabs.onActivated.addListener).toHaveBeenCalledWith(expect.any(Function))
      expect(mockChrome.tabs.onUpdated.addListener).toHaveBeenCalledWith(expect.any(Function))
      expect(monitor.isInitialized).toBe(true)
      expect(monitor.options).toEqual(options)
      expect(mockLogger.log).toHaveBeenCalledWith('TabMonitor initialized successfully')
    })

    test('should not initialize twice', async () => {
      await monitor.initialize()
      await monitor.initialize()

      expect(mockChrome.tabs.onActivated.addListener).toHaveBeenCalledTimes(1)
      expect(mockLogger.log).toHaveBeenCalledWith('TabMonitor already initialized')
    })

    test('should handle initialization errors', async () => {
      const error = new Error('Chrome API error')
      mockChrome.tabs.onActivated.addListener.mockImplementationOnce(() => {
        throw error
      })

      await expect(monitor.initialize()).rejects.toThrow(TabMonitorError)
      expect(monitor.isInitialized).toBe(false)
    })
  })

  describe('updateOptions', () => {
    test('should update options', () => {
      const newOptions = { enabledOrigins: { 'new.com': true } }

      monitor.updateOptions(newOptions)

      expect(monitor.options).toEqual(newOptions)
      expect(mockLogger.log).toHaveBeenCalledWith('TabMonitor options updated')
    })
  })

  describe('updateTabInfo', () => {
    beforeEach(() => {
      mockDomainManager.extractOrigin.mockReturnValue('https://example.com')
      mockDomainManager.isTargetDomain.mockReturnValue(true)
      mockDomainManager.shouldAutoEnable.mockReturnValue(true)
      mockConnectionTracker.getConnectionStats.mockResolvedValue({
        originCounts: { 'https://example.com': 2 },
        totalConnections: 2
      })
    })

    test('should handle invalid tab object', async () => {
      await monitor.updateTabInfo(null)
      await monitor.updateTabInfo({})

      expect(mockLogger.log).toHaveBeenCalledWith('Invalid tab object provided')
    })

    test('should set badge for invalid page', async () => {
      const tab = { id: 1, url: 'chrome://settings/' }

      await monitor.updateTabInfo(tab)

      expect(mockChrome.action.setTitle).toHaveBeenCalledWith({
        title: 'WebRTC Internals Exporter (no valid page)',
        tabId: 1
      })
      expect(mockChrome.action.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 1 })
    })

    test('should set badge for page with no URL', async () => {
      const tab = { id: 1 }

      await monitor.updateTabInfo(tab)

      expect(mockChrome.action.setTitle).toHaveBeenCalledWith({
        title: 'WebRTC Internals Exporter (no valid page)',
        tabId: 1
      })
    })

    test('should handle invalid URL from domain manager', async () => {
      const tab = { id: 1, url: 'https://example.com' }
      mockDomainManager.extractOrigin.mockReturnValue(null)

      await monitor.updateTabInfo(tab)

      expect(mockLogger.log).toHaveBeenCalledWith('Invalid URL: https://example.com')
    })

    test('should set badge for enabled domain', async () => {
      const tab = { id: 1, url: 'https://example.com' }

      await monitor.updateTabInfo(tab)

      expect(mockChrome.action.setTitle).toHaveBeenCalledWith({
        title: 'WebRTC Internals Exporter\nActive Peer Connections: 2',
        tabId: 1
      })
      expect(mockChrome.action.setBadgeText).toHaveBeenCalledWith({ text: '2', tabId: 1 })
      expect(mockChrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
        color: 'rgb(63, 81, 181)',
        tabId: 1
      })
    })

    test('should set badge for enabled domain with zero connections', async () => {
      const tab = { id: 1, url: 'https://example.com' }
      mockConnectionTracker.getConnectionStats.mockResolvedValue({
        originCounts: {},
        totalConnections: 0
      })

      await monitor.updateTabInfo(tab)

      expect(mockChrome.action.setBadgeText).toHaveBeenCalledWith({ text: '0', tabId: 1 })
    })

    test('should set badge for disabled target domain', async () => {
      const tab = { id: 1, url: 'https://example.com' }
      mockDomainManager.shouldAutoEnable.mockReturnValue(false)
      mockDomainManager.isTargetDomain.mockReturnValue(true)

      await monitor.updateTabInfo(tab)

      expect(mockChrome.action.setTitle).toHaveBeenCalledWith({
        title: 'WebRTC Internals Exporter (disabled)',
        tabId: 1
      })
      expect(mockChrome.action.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 1 })
    })

    test('should set badge for unsupported domain', async () => {
      const tab = { id: 1, url: 'https://unsupported.com' }
      mockDomainManager.shouldAutoEnable.mockReturnValue(false)
      mockDomainManager.isTargetDomain.mockReturnValue(false)

      await monitor.updateTabInfo(tab)

      expect(mockChrome.action.setTitle).toHaveBeenCalledWith({
        title: 'WebRTC Internals Exporter (unsupported domain)',
        tabId: 1
      })
    })

    test('should handle connection tracker errors gracefully', async () => {
      const tab = { id: 1, url: 'https://example.com' }
      mockConnectionTracker.getConnectionStats.mockRejectedValue(new Error('Connection error'))

      await monitor.updateTabInfo(tab)

      expect(mockLogger.log).toHaveBeenCalledWith('Error updating tab info for tab 1: Connection error')
      expect(mockChrome.action.setTitle).toHaveBeenCalledWith({
        title: 'WebRTC Internals Exporter (error)',
        tabId: 1
      })
      expect(mockChrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!', tabId: 1 })
    })

    test('should use pendingUrl if url is not available', async () => {
      const tab = { id: 1, pendingUrl: 'https://example.com' }

      await monitor.updateTabInfo(tab)

      expect(mockDomainManager.extractOrigin).toHaveBeenCalledWith('https://example.com')
    })
  })

  describe('updateCurrentTab', () => {
    test('should update current active tab', async () => {
      const tab = { id: 1, url: 'https://example.com', active: true }
      mockChrome.tabs.query.mockResolvedValue([tab])
      mockDomainManager.extractOrigin.mockReturnValue('https://example.com')
      mockDomainManager.isTargetDomain.mockReturnValue(true)
      mockDomainManager.shouldAutoEnable.mockReturnValue(true)

      await monitor.updateCurrentTab()

      expect(mockChrome.tabs.query).toHaveBeenCalledWith({
        active: true,
        lastFocusedWindow: true
      })
      expect(mockChrome.action.setTitle).toHaveBeenCalled()
    })

    test('should handle no active tab', async () => {
      mockChrome.tabs.query.mockResolvedValue([])

      await monitor.updateCurrentTab()

      expect(mockChrome.action.setTitle).not.toHaveBeenCalled()
    })

    test('should handle query errors gracefully', async () => {
      mockChrome.tabs.query.mockRejectedValue(new Error('Query failed'))

      await monitor.updateCurrentTab()

      expect(mockLogger.log).toHaveBeenCalledWith('Error updating current tab: Query failed')
    })
  })

  describe('updateAllTabs', () => {
    test('should update all tabs', async () => {
      const tabs = [
        { id: 1, url: 'https://example1.com' },
        { id: 2, url: 'https://example2.com' }
      ]
      mockChrome.tabs.query.mockResolvedValue(tabs)
      mockDomainManager.extractOrigin.mockReturnValue('https://example.com')

      await monitor.updateAllTabs()

      expect(mockChrome.tabs.query).toHaveBeenCalledWith({})
      expect(mockLogger.log).toHaveBeenCalledWith('Updated 2 tabs')
    })

    test('should handle query errors', async () => {
      mockChrome.tabs.query.mockRejectedValue(new Error('Query failed'))

      await monitor.updateAllTabs()

      expect(mockLogger.log).toHaveBeenCalledWith('Error updating all tabs: Query failed')
    })
  })

  describe('getStats', () => {
    test('should return tab statistics', async () => {
      const tabs = [
        { id: 1, url: 'https://teams.microsoft.com' },
        { id: 2, url: 'https://meet.google.com' },
        { id: 3, url: 'chrome://settings/' },
        { id: 4, url: 'https://other.com' }
      ]
      mockChrome.tabs.query.mockResolvedValue(tabs)
      mockDomainManager.extractOrigin.mockImplementation(url => {
        if (url.startsWith('http')) return url.split('/')[2]
        return null
      })
      mockDomainManager.isTargetDomain.mockImplementation(url => 
        url.includes('teams.microsoft.com') || url.includes('meet.google.com')
      )
      mockDomainManager.shouldAutoEnable.mockImplementation((origin, options) => 
        origin === 'teams.microsoft.com'
      )
      monitor.options = { enabledOrigins: { 'teams.microsoft.com': true } }

      const stats = await monitor.getStats()

      expect(stats).toEqual({
        totalTabs: 4,
        httpTabs: 3,
        targetTabs: 2,
        enabledTabs: 1,
        isInitialized: false
      })
    })

    test('should handle errors gracefully', async () => {
      mockChrome.tabs.query.mockRejectedValue(new Error('Query failed'))

      const stats = await monitor.getStats()

      expect(stats).toEqual({
        totalTabs: 0,
        httpTabs: 0,
        targetTabs: 0,
        enabledTabs: 0,
        isInitialized: false,
        error: 'Query failed'
      })
    })
  })

  describe('configureBadge', () => {
    test('should update badge configuration', () => {
      const newConfig = {
        enabledColor: 'red',
        titles: { base: 'New Title' }
      }

      monitor.configureBadge(newConfig)

      expect(monitor.badgeConfig.enabledColor).toBe('red')
      expect(monitor.badgeConfig.titles.base).toBe('New Title')
      // The titles object gets completely replaced, so other values are gone
      expect(monitor.badgeConfig.titles.noValidPage).toBeUndefined()
      expect(mockLogger.log).toHaveBeenCalledWith('Badge configuration updated')
    })
  })

  describe('clearBadge', () => {
    test('should clear badge for specific tab', async () => {
      await monitor.clearBadge(1)

      expect(mockChrome.action.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 1 })
      expect(mockChrome.action.setTitle).toHaveBeenCalledWith({ 
        title: 'WebRTC Internals Exporter', 
        tabId: 1 
      })
    })

    test('should handle Chrome API errors', async () => {
      mockChrome.action.setBadgeText.mockRejectedValue(new Error('API error'))

      await monitor.clearBadge(1)

      expect(mockLogger.log).toHaveBeenCalledWith('Error clearing badge for tab 1: API error')
    })
  })

  describe('private event handlers', () => {
    test('should handle tab activation', async () => {
      await monitor.initialize()
      
      const activatedListener = mockChrome.tabs.onActivated.addListener.mock.calls[0][0]
      const tab = { id: 1, url: 'https://example.com' }
      mockChrome.tabs.get.mockResolvedValue(tab)
      mockDomainManager.extractOrigin.mockReturnValue('https://example.com')
      
      await activatedListener({ tabId: 1 })

      expect(mockChrome.tabs.get).toHaveBeenCalledWith(1)
      expect(mockDomainManager.extractOrigin).toHaveBeenCalledWith('https://example.com')
    })

    test('should handle tab activation errors', async () => {
      await monitor.initialize()
      
      const activatedListener = mockChrome.tabs.onActivated.addListener.mock.calls[0][0]
      mockChrome.tabs.get.mockRejectedValue(new Error('Tab not found'))
      
      await activatedListener({ tabId: 1 })

      expect(mockLogger.log).toHaveBeenCalledWith('Tab activation error: Tab not found')
    })

    test('should handle tab updates', async () => {
      await monitor.initialize()
      
      const updatedListener = mockChrome.tabs.onUpdated.addListener.mock.calls[0][0]
      const tab = { id: 1, url: 'https://example.com' }
      mockChrome.tabs.get.mockResolvedValue(tab)
      
      await updatedListener(1, { url: 'https://example.com' })

      expect(mockChrome.tabs.get).toHaveBeenCalledWith(1)
    })

    test('should ignore tab updates without URL changes', async () => {
      await monitor.initialize()
      
      const updatedListener = mockChrome.tabs.onUpdated.addListener.mock.calls[0][0]
      
      await updatedListener(1, { status: 'complete' })

      expect(mockChrome.tabs.get).not.toHaveBeenCalled()
    })

    test('should handle tab update errors', async () => {
      await monitor.initialize()
      
      const updatedListener = mockChrome.tabs.onUpdated.addListener.mock.calls[0][0]
      mockChrome.tabs.get.mockRejectedValue(new Error('Tab error'))
      
      await updatedListener(1, { url: 'https://example.com' })

      expect(mockLogger.log).toHaveBeenCalledWith('Tab update error: Tab error')
    })
  })

  describe('destroy', () => {
    test('should clean up resources', () => {
      monitor.options = { test: true }
      monitor.isInitialized = true

      monitor.destroy()

      expect(monitor.isInitialized).toBe(false)
      expect(monitor.options).toEqual({})
      expect(mockLogger.log).toHaveBeenCalledWith('TabMonitor destroyed')
    })
  })

  describe('TabMonitorError', () => {
    test('should create custom error', () => {
      const error = new TabMonitorError('Test error message')
      
      expect(error.name).toBe('TabMonitorError')
      expect(error.message).toBe('Test error message')
      expect(error instanceof Error).toBe(true)
    })
  })

  describe('createTabMonitor', () => {
    test('should create monitor with dependencies', () => {
      const monitor = createTabMonitor({
        domainManager: mockDomainManager,
        connectionTracker: mockConnectionTracker,
        logger: mockLogger
      })

      expect(monitor).toBeInstanceOf(TabMonitor)
      expect(monitor.domainManager).toBe(mockDomainManager)
      expect(monitor.connectionTracker).toBe(mockConnectionTracker)
      expect(monitor.logger).toBe(mockLogger)
    })
  })

  describe('createAndInitializeTabMonitor', () => {
    test('should create and initialize monitor', async () => {
      const options = { enabledOrigins: { 'example.com': true } }
      
      const monitor = await createAndInitializeTabMonitor({
        domainManager: mockDomainManager,
        connectionTracker: mockConnectionTracker,
        logger: mockLogger
      }, options)

      expect(monitor).toBeInstanceOf(TabMonitor)
      expect(monitor.isInitialized).toBe(true)
      expect(monitor.options).toEqual(options)

      monitor.destroy()
    })

    test('should work without initial options', async () => {
      const monitor = await createAndInitializeTabMonitor({
        domainManager: mockDomainManager,
        connectionTracker: mockConnectionTracker,
        logger: mockLogger
      })

      expect(monitor.isInitialized).toBe(true)
      expect(monitor.options).toEqual({})

      monitor.destroy()
    })
  })
})