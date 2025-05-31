/**
 * Jest setup file that runs after the test framework is initialized
 * This file has access to Jest globals like beforeEach, afterEach, etc.
 */

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
  if (global.fetch && typeof global.fetch.mockResolvedValue === 'function') {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('')
    });
  }
  
  // Reset pako mock
  if (global.pako && global.pako.gzip && typeof global.pako.gzip === 'function') {
    global.pako.gzip = jest.fn().mockReturnValue('mocked-gzipped-data');
  }
  
  // Reset Chrome API mocks to default behaviors (only if they are jest mocks)
  if (global.chrome && global.chrome.storage) {
    if (global.chrome.storage.sync && global.chrome.storage.sync.get && typeof global.chrome.storage.sync.get.mockResolvedValue === 'function') {
      global.chrome.storage.sync.get.mockResolvedValue({});
    }
    if (global.chrome.storage.sync && global.chrome.storage.sync.set && typeof global.chrome.storage.sync.set.mockResolvedValue === 'function') {
      global.chrome.storage.sync.set.mockResolvedValue();
    }
    if (global.chrome.storage.local && global.chrome.storage.local.get && typeof global.chrome.storage.local.get.mockResolvedValue === 'function') {
      global.chrome.storage.local.get.mockResolvedValue({});
    }
    if (global.chrome.storage.local && global.chrome.storage.local.set && typeof global.chrome.storage.local.set.mockResolvedValue === 'function') {
      global.chrome.storage.local.set.mockResolvedValue();
    }
  }
  
  if (global.chrome && global.chrome.runtime) {
    if (global.chrome.runtime.sendMessage && typeof global.chrome.runtime.sendMessage.mockResolvedValue === 'function') {
      global.chrome.runtime.sendMessage.mockResolvedValue({});
    }
    if (global.chrome.runtime.getURL && typeof global.chrome.runtime.getURL.mockImplementation === 'function') {
      global.chrome.runtime.getURL.mockImplementation((path) => `chrome-extension://test-id/${path}`);
    }
  }
  
  if (global.chrome && global.chrome.tabs && global.chrome.tabs.query && typeof global.chrome.tabs.query.mockResolvedValue === 'function') {
    global.chrome.tabs.query.mockResolvedValue([]);
  }
});

// Clean up after each test
afterEach(() => {
  // Clear any timers or intervals
  jest.clearAllTimers();
  
  // Clean up any global state
  delete global.WebRTCExporterConfig;
  delete global.WebRTCExporterDomains;
  delete global.WebRTCExporterStorage;
  delete globalThis.WebRTCExporterConfig;
  delete globalThis.WebRTCExporterDomains;
  delete globalThis.WebRTCExporterStorage;
});