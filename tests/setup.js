/**
 * Jest test setup file
 * Configures global test environment for Chrome extension testing
 */

// Define globalThis if not defined
if (typeof globalThis === 'undefined') {
  Object.defineProperty(global, 'globalThis', {
    value: global,
    writable: true,
    configurable: true
  });
}

// Mock self for service worker environment
if (typeof self === 'undefined') {
  global.self = global;
}

// Mock importScripts for service worker testing
global.importScripts = jest.fn();

// Mock Chrome APIs
global.chrome = {
  storage: {
    sync: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(),
      clear: jest.fn(),
      remove: jest.fn(),
      onChanged: {
        addListener: jest.fn(),
        removeListener: jest.fn()
      }
    },
    local: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(),
      clear: jest.fn(),
      remove: jest.fn(),
      onChanged: {
        addListener: jest.fn(),
        removeListener: jest.fn()
      }
    },
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },
  runtime: {
    sendMessage: jest.fn().mockResolvedValue({}),
    getURL: jest.fn((path) => `chrome-extension://test-id/${path}`),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },
  tabs: {
    query: jest.fn().mockResolvedValue([]),
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onRemoved: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  }
};

// Mock fetch
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve('')
});

// Mock pako (gzip compression library)
global.pako = {
  gzip: jest.fn().mockReturnValue('mocked-gzipped-data')
};

// Setup test environment before each test
beforeEach(() => {
  // Clear all mocks
  jest.clearAllMocks();
  
  // Reset importScripts mock
  if (global.importScripts && typeof global.importScripts.mockImplementation === 'function') {
    global.importScripts.mockImplementation(() => {
      // Do nothing - modules are loaded via loadSharedModules
    });
  }
  
  // Reset fetch mock
  global.fetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve('')
  });
  
  // Reset pako mock
  global.pako.gzip = jest.fn().mockReturnValue('mocked-gzipped-data');
});

// Clean up after each test
afterEach(() => {
  // Clear any timers or intervals
  jest.clearAllTimers();
});

// Helper function to create mock tab objects
global.createMockTab = (overrides = {}) => ({
  id: 1,
  url: 'https://meet.google.com/test-meeting',
  title: 'Test Meeting',
  active: true,
  windowId: 1,
  ...overrides
});

// Helper function to create mock WebRTC stats
global.createMockWebRTCStats = (type = 'inbound-rtp', overrides = {}) => ({
  id: `test-${type}-${Date.now()}`,
  type,
  timestamp: Date.now(),
  bytesReceived: 1000,
  packetsReceived: 10,
  packetsLost: 0,
  jitter: 0.001,
  ...overrides
});

// Helper to mock storage with specific data
global.mockStorage = (syncData = {}, localData = {}) => {
  chrome.storage.sync.get.mockImplementation((keys) => {
    if (!keys) return Promise.resolve(syncData);
    if (Array.isArray(keys)) {
      const result = {};
      keys.forEach(key => {
        if (syncData[key] !== undefined) result[key] = syncData[key];
      });
      return Promise.resolve(result);
    }
    return Promise.resolve(syncData[keys] !== undefined ? { [keys]: syncData[keys] } : {});
  });
  
  chrome.storage.local.get.mockImplementation((keys) => {
    if (!keys) return Promise.resolve(localData);
    if (Array.isArray(keys)) {
      const result = {};
      keys.forEach(key => {
        if (localData[key] !== undefined) result[key] = localData[key];
      });
      return Promise.resolve(result);
    }
    return Promise.resolve(localData[keys] !== undefined ? { [keys]: localData[keys] } : {});
  });
};

// Helper to load shared modules in tests
global.loadSharedModules = () => {
  // Clear existing modules to ensure fresh load
  delete global.WebRTCExporterConfig;
  delete global.WebRTCExporterDomains;
  delete global.WebRTCExporterStorage;
  delete globalThis.WebRTCExporterConfig;
  delete globalThis.WebRTCExporterDomains;
  delete globalThis.WebRTCExporterStorage;
  
  // Simulate loading shared modules by executing their code
  // This is needed because tests run in Node.js, not a browser environment
  const path = require('path');
  const fs = require('fs');
  
  const sharedDir = path.join(__dirname, '..', 'shared');
  
  try {
    // Load config.js
    const configPath = path.join(sharedDir, 'config.js');
    const configCode = fs.readFileSync(configPath, 'utf8');
    eval(configCode);
    
    // Load domains.js  
    const domainsPath = path.join(sharedDir, 'domains.js');
    const domainsCode = fs.readFileSync(domainsPath, 'utf8');
    eval(domainsCode);
    
    // Load storage.js
    const storagePath = path.join(sharedDir, 'storage.js');
    const storageCode = fs.readFileSync(storagePath, 'utf8');
    eval(storageCode);
    
    // Verify modules loaded correctly
    if (!global.WebRTCExporterConfig && !globalThis.WebRTCExporterConfig) {
      throw new Error('Failed to load WebRTCExporterConfig');
    }
    if (!global.WebRTCExporterDomains && !globalThis.WebRTCExporterDomains) {
      throw new Error('Failed to load WebRTCExporterDomains');
    }
    if (!global.WebRTCExporterStorage && !globalThis.WebRTCExporterStorage) {
      throw new Error('Failed to load WebRTCExporterStorage');
    }
  } catch (error) {
    console.error('Error loading shared modules:', error);
    throw error;
  }
};