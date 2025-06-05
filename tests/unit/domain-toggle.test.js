/**
 * Unit tests for Domain Enable/Disable Functionality
 * Tests the issue where disabled domains were still capturing WebRTC stats
 */

const fs = require('fs')
const path = require('path')

describe('Domain Toggle Functionality', () => {
  let DomainManager
  let mockStorage
  let mockChrome

  beforeAll(() => {
    // Load the domains module
    const domainsPath = path.join(__dirname, '../../shared/domains.js')
    const domainsCode = fs.readFileSync(domainsPath, 'utf8')
    
    // Execute the module code
    const domainsFunction = new Function('global', 'globalThis', 'self', 'window', 'console', domainsCode)
    domainsFunction(global, global, global, global, console)
    
    // Get the exported DomainManager
    DomainManager = global.WebRTCExporterDomains.DomainManager
  })

  beforeEach(() => {
    // Mock Chrome storage API
    mockStorage = {
      sync: {
        get: jest.fn(),
        set: jest.fn(),
        onChanged: {
          addListener: jest.fn()
        }
      }
    }

    mockChrome = {
      storage: mockStorage,
      runtime: {
        getURL: jest.fn((path) => `chrome-extension://mock-id/${path}`)
      }
    }

    // Set up global mocks
    global.chrome = mockChrome
    global.window = {
      location: {
        origin: 'https://teams.microsoft.com',
        protocol: 'https:'
      },
      WebRTCExporterDomains: global.WebRTCExporterDomains,
      postMessage: jest.fn(),
      addEventListener: jest.fn()
    }
    global.document = {
      head: {
        appendChild: jest.fn()
      },
      createElement: jest.fn(() => ({
        onload: null,
        src: ''
      }))
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('DomainManager.shouldAutoEnable', () => {
    test('should auto-enable target domains by default', () => {
      const enabledOrigins = {}
      
      // Test various target domain formats
      expect(DomainManager.shouldAutoEnable('https://teams.microsoft.com', enabledOrigins)).toBe(true)
      expect(DomainManager.shouldAutoEnable('https://meet.google.com', enabledOrigins)).toBe(true)
      expect(DomainManager.shouldAutoEnable('https://subdomain.teams.microsoft.com', enabledOrigins)).toBe(true)
    })

    test('should respect explicit disable setting for target domains', () => {
      const enabledOrigins = {
        'https://teams.microsoft.com': false,
        'teams.microsoft.com': false
      }
      
      // Both origin and domain key formats should work
      expect(DomainManager.shouldAutoEnable('https://teams.microsoft.com', enabledOrigins)).toBe(false)
      expect(DomainManager.shouldAutoEnable('teams.microsoft.com', enabledOrigins)).toBe(false)
    })

    test('should not auto-enable non-target domains', () => {
      const enabledOrigins = {}
      
      expect(DomainManager.shouldAutoEnable('https://example.com', enabledOrigins)).toBe(false)
      expect(DomainManager.shouldAutoEnable('https://random-site.com', enabledOrigins)).toBe(false)
    })

    test('should enable non-target domains when explicitly set', () => {
      const enabledOrigins = {
        'https://example.com': true
      }
      
      expect(DomainManager.shouldAutoEnable('https://example.com', enabledOrigins)).toBe(true)
    })

    test('should handle subdomain matching correctly', () => {
      const enabledOrigins = {
        'teams.microsoft.com': false // Disable the base domain
      }
      
      // Subdomains should also be disabled
      expect(DomainManager.shouldAutoEnable('https://subdomain.teams.microsoft.com', enabledOrigins)).toBe(false)
      expect(DomainManager.shouldAutoEnable('https://teams.microsoft.com', enabledOrigins)).toBe(false)
    })
  })

  describe('Content Script Domain Checking', () => {
    let contentScriptLogic

    beforeEach(() => {
      // Simulate the content script's domain checking logic
      contentScriptLogic = {
        checkDomainEnabled: (origin, enabledOrigins) => {
          // Use the DomainManager directly (should always be available in tests)
          return DomainManager.shouldAutoEnable(origin, enabledOrigins || {})
        }
      }
    })

    test('should properly detect disabled Teams domain', () => {
      const enabledOrigins = {
        'teams.microsoft.com': false
      }
      
      // This should be false (disabled) with the new logic
      const result = contentScriptLogic.checkDomainEnabled('https://teams.microsoft.com', enabledOrigins)
      expect(result).toBe(false)
    })

    test('should handle mixed origin and domain key formats', () => {
      const enabledOrigins = {
        'teams.microsoft.com': false, // Domain key format
        'https://meet.google.com': false // Origin key format
      }
      
      expect(contentScriptLogic.checkDomainEnabled('https://teams.microsoft.com', enabledOrigins)).toBe(false)
      expect(contentScriptLogic.checkDomainEnabled('https://meet.google.com', enabledOrigins)).toBe(false)
    })

    test('should auto-enable when no explicit setting exists', () => {
      const enabledOrigins = {}
      
      // Target domains should be auto-enabled
      expect(contentScriptLogic.checkDomainEnabled('https://teams.microsoft.com', enabledOrigins)).toBe(true)
      expect(contentScriptLogic.checkDomainEnabled('https://meet.google.com', enabledOrigins)).toBe(true)
    })

    test('should handle storage change events correctly', () => {
      const oldEnabledOrigins = {}
      const newEnabledOrigins = {
        'teams.microsoft.com': false
      }
      
      // Simulate initial state (enabled)
      expect(contentScriptLogic.checkDomainEnabled('https://teams.microsoft.com', oldEnabledOrigins)).toBe(true)
      
      // Simulate after change (disabled)
      expect(contentScriptLogic.checkDomainEnabled('https://teams.microsoft.com', newEnabledOrigins)).toBe(false)
    })
  })

  describe('Options Page Toggle Logic', () => {
    let optionsPageLogic

    beforeEach(() => {
      // Simulate the options page's toggle logic
      optionsPageLogic = {
        toggleDomain: (domain, currentEnabledOrigins) => {
          const origins = { ...currentEnabledOrigins }
          const isTargetDomain = DomainManager.isTargetDomain(domain)

          if (isTargetDomain) {
            // For target domains, toggle between auto-enabled (undefined) and disabled (false)
            if (origins[domain] === false) {
              delete origins[domain] // Remove to allow auto-enable
            } else {
              origins[domain] = false // Explicitly disable
            }
          } else {
            // For manual origins, toggle between enabled and disabled
            origins[domain] = !origins[domain]
          }

          return origins
        },

        getDomainStatus: (domain, enabledOrigins) => {
          const isTargetDomain = DomainManager.isTargetDomain(domain)
          const explicitSetting = enabledOrigins[domain]

          if (explicitSetting === false) {
            return { status: 'Disabled', className: 'disabled' }
          } else if (explicitSetting === true) {
            return { status: 'Enabled', className: 'enabled' }
          } else if (isTargetDomain) {
            return { status: 'Auto-enabled', className: 'auto-enabled' }
          } else {
            return { status: 'Manual', className: 'manual' }
          }
        }
      }
    })

    test('should toggle Teams domain from auto-enabled to disabled', () => {
      const initialOrigins = {}
      const domain = 'teams.microsoft.com'
      
      // Initial status should be auto-enabled
      expect(optionsPageLogic.getDomainStatus(domain, initialOrigins))
        .toEqual({ status: 'Auto-enabled', className: 'auto-enabled' })
      
      // Toggle to disabled
      const newOrigins = optionsPageLogic.toggleDomain(domain, initialOrigins)
      expect(newOrigins[domain]).toBe(false)
      expect(optionsPageLogic.getDomainStatus(domain, newOrigins))
        .toEqual({ status: 'Disabled', className: 'disabled' })
    })

    test('should toggle Teams domain from disabled back to auto-enabled', () => {
      const initialOrigins = { 'teams.microsoft.com': false }
      const domain = 'teams.microsoft.com'
      
      // Initial status should be disabled
      expect(optionsPageLogic.getDomainStatus(domain, initialOrigins))
        .toEqual({ status: 'Disabled', className: 'disabled' })
      
      // Toggle back to auto-enabled
      const newOrigins = optionsPageLogic.toggleDomain(domain, initialOrigins)
      expect(newOrigins[domain]).toBeUndefined()
      expect(optionsPageLogic.getDomainStatus(domain, newOrigins))
        .toEqual({ status: 'Auto-enabled', className: 'auto-enabled' })
    })

    test('should handle both domain and origin formats consistently', () => {
      const testCases = [
        'teams.microsoft.com',
        'https://teams.microsoft.com',
        'meet.google.com',
        'https://meet.google.com'
      ]

      testCases.forEach(domain => {
        const initialOrigins = {}
        
        // Should be detected as target domain
        expect(DomainManager.isTargetDomain(domain)).toBe(true)
        
        // Should start as auto-enabled
        expect(optionsPageLogic.getDomainStatus(domain, initialOrigins))
          .toEqual({ status: 'Auto-enabled', className: 'auto-enabled' })
        
        // Should toggle to disabled
        const newOrigins = optionsPageLogic.toggleDomain(domain, initialOrigins)
        expect(newOrigins[domain]).toBe(false)
      })
    })

    test('should handle non-target domain toggle correctly', () => {
      const domain = 'https://example.com'
      const initialOrigins = {}
      
      // Should not be a target domain
      expect(DomainManager.isTargetDomain(domain)).toBe(false)
      
      // Should start as manual/undefined
      expect(optionsPageLogic.getDomainStatus(domain, initialOrigins))
        .toEqual({ status: 'Manual', className: 'manual' })
      
      // Toggle should enable it
      const newOrigins = optionsPageLogic.toggleDomain(domain, initialOrigins)
      expect(newOrigins[domain]).toBe(true)
      expect(optionsPageLogic.getDomainStatus(domain, newOrigins))
        .toEqual({ status: 'Enabled', className: 'enabled' })
    })
  })

  describe('Integration: End-to-End Domain Toggle', () => {
    test('should properly disable Teams domain end-to-end', () => {
      // 1. Initial state: Teams should be auto-enabled
      const initialOrigins = {}
      const domain = 'teams.microsoft.com'
      const origin = 'https://teams.microsoft.com'
      
      expect(DomainManager.shouldAutoEnable(origin, initialOrigins)).toBe(true)
      
      // 2. User clicks disable in options page
      const optionsPageLogic = {
        toggleDomain: (domain, currentOrigins) => {
          const origins = { ...currentOrigins }
          const isTargetDomain = DomainManager.isTargetDomain(domain)
          if (isTargetDomain) {
            origins[domain] = false
          }
          return origins
        }
      }
      
      const newOrigins = optionsPageLogic.toggleDomain(domain, initialOrigins)
      expect(newOrigins[domain]).toBe(false)
      
      // 3. Content script should now detect domain as disabled
      expect(DomainManager.shouldAutoEnable(origin, newOrigins)).toBe(false)
      
      // 4. Different origin formats should also be disabled
      expect(DomainManager.shouldAutoEnable('https://subdomain.teams.microsoft.com', newOrigins)).toBe(false)
    })

    test('should handle storage format inconsistencies gracefully', () => {
      // Test various storage formats that might exist
      const testScenarios = [
        {
          name: 'Domain key format',
          enabledOrigins: { 'teams.microsoft.com': false },
          testOrigin: 'https://teams.microsoft.com',
          expectedEnabled: false
        },
        {
          name: 'Origin key format',
          enabledOrigins: { 'https://teams.microsoft.com': false },
          testOrigin: 'https://teams.microsoft.com',
          expectedEnabled: false
        },
        {
          name: 'Mixed formats',
          enabledOrigins: { 
            'teams.microsoft.com': false,
            'https://meet.google.com': false
          },
          testOrigin: 'https://teams.microsoft.com',
          expectedEnabled: false
        }
      ]

      testScenarios.forEach(({ name, enabledOrigins, testOrigin, expectedEnabled }) => {
        const result = DomainManager.shouldAutoEnable(testOrigin, enabledOrigins)
        expect(result).toBe(expectedEnabled, `Failed scenario: ${name}`)
      })
    })
  })

  describe('Regression Tests', () => {
    test('should not break existing functionality for enabled domains', () => {
      const enabledOrigins = {
        'teams.microsoft.com': false, // Teams disabled
        'https://example.com': true   // Custom domain enabled
      }
      
      // Teams should be disabled
      expect(DomainManager.shouldAutoEnable('https://teams.microsoft.com', enabledOrigins)).toBe(false)
      
      // Google Meet should still be auto-enabled (not in disabled list)
      expect(DomainManager.shouldAutoEnable('https://meet.google.com', enabledOrigins)).toBe(true)
      
      // Custom domain should be enabled
      expect(DomainManager.shouldAutoEnable('https://example.com', enabledOrigins)).toBe(true)
    })

    test('should handle empty or malformed enabledOrigins gracefully', () => {
      const testCases = [
        undefined,
        null,
        {},
        { malformed: 'value' }
      ]

      testCases.forEach(enabledOrigins => {
        // Should not throw errors and should default to auto-enable for target domains
        expect(() => {
          DomainManager.shouldAutoEnable('https://teams.microsoft.com', enabledOrigins)
        }).not.toThrow()
        
        expect(DomainManager.shouldAutoEnable('https://teams.microsoft.com', enabledOrigins)).toBe(true)
      })
    })
  })
})
