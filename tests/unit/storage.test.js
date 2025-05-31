/**
 * Unit tests for shared/storage.js
 * Tests storage abstraction layer and error handling
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

describe('Storage Module', () => {
  let StorageManager;

  beforeEach(() => {
    // Clear any existing global objects
    delete global.WebRTCExporterStorage;
    delete global.window;
    delete global.globalThis;
    
    // Load the modules
    loadSharedModules();
    
    StorageManager = global.WebRTCExporterStorage.StorageManager;
    
    // Reset Chrome API mocks
    jest.clearAllMocks();
  });

  describe('StorageManager.get', () => {
    test('should get all data when no keys specified', async () => {
      const testData = { url: 'http://test.com', agentId: 'test-agent' };
      chrome.storage.sync.get.mockResolvedValue(testData);
      
      const result = await StorageManager.get();
      
      expect(chrome.storage.sync.get).toHaveBeenCalledWith(null);
      expect(result).toEqual(testData);
    });

    test('should get specific keys when array provided', async () => {
      const testData = { url: 'http://test.com' };
      chrome.storage.sync.get.mockResolvedValue(testData);
      
      const result = await StorageManager.get(['url', 'agentId']);
      
      expect(chrome.storage.sync.get).toHaveBeenCalledWith(['url', 'agentId']);
      expect(result).toEqual(testData);
    });

    test('should get single key when string provided', async () => {
      const testData = { url: 'http://test.com' };
      chrome.storage.sync.get.mockResolvedValue(testData);
      
      const result = await StorageManager.get('url');
      
      expect(chrome.storage.sync.get).toHaveBeenCalledWith('url');
      expect(result).toEqual(testData);
    });

    test('should handle Chrome storage errors', async () => {
      const error = new Error('Storage quota exceeded');
      chrome.storage.sync.get.mockRejectedValue(error);
      
      await expect(StorageManager.get()).rejects.toThrow('Failed to retrieve data from storage');
    });

    test('should validate config when retrieving options', async () => {
      const invalidData = { url: 123, updateInterval: -1 };
      chrome.storage.sync.get.mockResolvedValue(invalidData);
      
      const result = await StorageManager.get(['url']);
      
      // Should merge with defaults for invalid config
      expect(result.url).toBe(global.WebRTCExporterConfig.DEFAULT_OPTIONS.url);
    });

    test('should use fallback when Chrome storage unavailable', async () => {
      // Temporarily remove chrome global
      const originalChrome = global.chrome;
      delete global.chrome;
      
      const result = await StorageManager.get();
      
      expect(result).toEqual({});
      
      // Restore chrome global
      global.chrome = originalChrome;
    });
  });

  describe('StorageManager.set', () => {
    test('should save valid data', async () => {
      const testData = { url: 'http://test.com', agentId: 'test-agent' };
      chrome.storage.sync.set.mockResolvedValue();
      
      await StorageManager.set(testData);
      
      expect(chrome.storage.sync.set).toHaveBeenCalledWith(testData);
    });

    test('should validate data before saving', async () => {
      const invalidData = { url: 123 };
      
      await expect(StorageManager.set(invalidData)).rejects.toThrow('Invalid configuration');
    });

    test('should reject null or undefined data', async () => {
      await expect(StorageManager.set(null)).rejects.toThrow('Data must be a non-null object');
      await expect(StorageManager.set(undefined)).rejects.toThrow('Data must be a non-null object');
    });

    test('should reject non-object data', async () => {
      await expect(StorageManager.set('string')).rejects.toThrow('Data must be a non-null object');
      await expect(StorageManager.set(123)).rejects.toThrow('Data must be a non-null object');
      await expect(StorageManager.set(['array'])).rejects.toThrow('Data must be a non-null object');
    });

    test('should handle Chrome storage errors', async () => {
      const error = new Error('Storage quota exceeded');
      chrome.storage.sync.set.mockRejectedValue(error);
      
      const validData = { url: 'http://test.com' };
      await expect(StorageManager.set(validData)).rejects.toThrow('Failed to save data to storage');
    });

    test('should use fallback when Chrome storage unavailable', async () => {
      // Temporarily remove chrome global
      const originalChrome = global.chrome;
      delete global.chrome;
      
      const testData = { url: 'http://test.com' };
      await expect(StorageManager.set(testData)).resolves.toBeUndefined();
      
      // Restore chrome global
      global.chrome = originalChrome;
    });
  });

  describe('StorageManager.getLocal', () => {
    test('should get local storage data', async () => {
      const testData = { peerConnections: 5 };
      chrome.storage.local.get.mockResolvedValue(testData);
      
      const result = await StorageManager.getLocal(['peerConnections']);
      
      expect(chrome.storage.local.get).toHaveBeenCalledWith(['peerConnections']);
      expect(result).toEqual(testData);
    });

    test('should handle local storage errors', async () => {
      const error = new Error('Local storage error');
      chrome.storage.local.get.mockRejectedValue(error);
      
      await expect(StorageManager.getLocal()).rejects.toThrow('Failed to retrieve local data');
    });

    test('should return empty object when Chrome storage unavailable', async () => {
      // Temporarily remove chrome global
      const originalChrome = global.chrome;
      delete global.chrome;
      
      const result = await StorageManager.getLocal();
      
      expect(result).toEqual({});
      
      // Restore chrome global
      global.chrome = originalChrome;
    });
  });

  describe('StorageManager.setLocal', () => {
    test('should save data to local storage', async () => {
      const testData = { stats: { connections: 5 } };
      chrome.storage.local.set.mockResolvedValue();
      
      await StorageManager.setLocal(testData);
      
      expect(chrome.storage.local.set).toHaveBeenCalledWith(testData);
    });

    test('should handle local storage errors', async () => {
      const error = new Error('Local storage quota exceeded');
      chrome.storage.local.set.mockRejectedValue(error);
      
      const testData = { stats: {} };
      await expect(StorageManager.setLocal(testData)).rejects.toThrow('Failed to save local data');
    });
  });

  describe('StorageManager.getOptions', () => {
    test('should return merged options with defaults', async () => {
      const storedData = { url: 'http://custom.com', agentId: 'custom-agent' };
      chrome.storage.sync.get.mockResolvedValue(storedData);
      
      const result = await StorageManager.getOptions();
      
      expect(result.url).toBe('http://custom.com');
      expect(result.agentId).toBe('custom-agent');
      expect(result.updateInterval).toBe(global.WebRTCExporterConfig.DEFAULT_OPTIONS.updateInterval);
      expect(result.job).toBe(global.WebRTCExporterConfig.DEFAULT_OPTIONS.job);
    });

    test('should ensure enabledStats is always an array', async () => {
      const storedData = { enabledStats: { 'inbound-rtp': true, 'outbound-rtp': false } };
      chrome.storage.sync.get.mockResolvedValue(storedData);
      
      const result = await StorageManager.getOptions();
      
      expect(Array.isArray(result.enabledStats)).toBe(true);
    });

    test('should use defaults when storage fails', async () => {
      chrome.storage.sync.get.mockRejectedValue(new Error('Storage error'));
      
      const result = await StorageManager.getOptions();
      
      expect(result).toEqual(global.WebRTCExporterConfig.DEFAULT_OPTIONS);
    });
  });

  describe('StorageManager.updateOptions', () => {
    test('should merge updates with current options', async () => {
      const currentOptions = { url: 'http://old.com', agentId: 'old-agent', updateInterval: 2 };
      const updates = { url: 'http://new.com', agentId: 'new-agent' };
      
      chrome.storage.sync.get.mockResolvedValue(currentOptions);
      chrome.storage.sync.set.mockResolvedValue();
      
      const result = await StorageManager.updateOptions(updates);
      
      expect(result.url).toBe('http://new.com');
      expect(result.agentId).toBe('new-agent');
      expect(result.updateInterval).toBe(2); // Should keep existing value
      
      expect(chrome.storage.sync.set).toHaveBeenCalledWith(expect.objectContaining(updates));
    });

    test('should handle update errors', async () => {
      chrome.storage.sync.get.mockResolvedValue({});
      chrome.storage.sync.set.mockRejectedValue(new Error('Update failed'));
      
      await expect(StorageManager.updateOptions({ url: 'http://test.com' })).rejects.toThrow('Update failed');
    });
  });

  describe('StorageManager.getStats', () => {
    test('should retrieve statistics data', async () => {
      const statsData = {
        peerConnectionsPerOrigin: { 'https://meet.google.com': 2 },
        messagesSent: 100,
        bytesSent: 50000
      };
      chrome.storage.local.get.mockResolvedValue(statsData);
      
      const result = await StorageManager.getStats();
      
      expect(result).toEqual(statsData);
    });

    test('should handle missing constants gracefully', async () => {
      // Temporarily remove config
      const originalConfig = global.WebRTCExporterConfig;
      delete global.WebRTCExporterConfig;
      
      chrome.storage.local.get.mockResolvedValue({});
      
      const result = await StorageManager.getStats();
      
      expect(result).toEqual({});
      
      // Restore config
      global.WebRTCExporterConfig = originalConfig;
    });
  });

  describe('StorageManager.onChanged', () => {
    test('should register storage change listener', () => {
      const callback = jest.fn();
      
      const cleanup = StorageManager.onChanged(callback);
      
      expect(chrome.storage.onChanged.addListener).toHaveBeenCalled();
      expect(typeof cleanup).toBe('function');
    });

    test('should filter sync storage changes', () => {
      const callback = jest.fn();
      StorageManager.onChanged(callback);
      
      // Get the listener that was registered
      const listener = chrome.storage.onChanged.addListener.mock.calls[0][0];
      
      // Simulate sync storage change
      const changes = { url: { newValue: 'http://new.com', oldValue: 'http://old.com' } };
      listener(changes, 'sync');
      
      expect(callback).toHaveBeenCalledWith(changes);
    });

    test('should ignore local storage changes', () => {
      const callback = jest.fn();
      StorageManager.onChanged(callback);
      
      // Get the listener that was registered
      const listener = chrome.storage.onChanged.addListener.mock.calls[0][0];
      
      // Simulate local storage change
      const changes = { stats: { newValue: {}, oldValue: {} } };
      listener(changes, 'local');
      
      expect(callback).not.toHaveBeenCalled();
    });

    test('should cleanup listener when cleanup function called', () => {
      const callback = jest.fn();
      const cleanup = StorageManager.onChanged(callback);
      
      cleanup();
      
      expect(chrome.storage.onChanged.removeListener).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should throw StorageError for storage failures', async () => {
      chrome.storage.sync.get.mockRejectedValue(new Error('Original error'));
      
      try {
        await StorageManager.get();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Failed to retrieve data from storage');
        expect(error.name).toBe('StorageError');
        expect(error.originalError).toBeDefined();
      }
    });

    test('should include original error details', async () => {
      const originalError = new Error('Quota exceeded');
      chrome.storage.sync.set.mockRejectedValue(originalError);
      
      try {
        await StorageManager.set({ url: 'http://test.com' });
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.originalError).toBe(originalError);
      }
    });
  });

  describe('Global Export', () => {
    test('should export to window in browser environment', () => {
      global.window = {};
      
      // Re-load the module
      loadSharedModules();
      
      expect(global.window.WebRTCExporterStorage).toBeDefined();
      expect(global.window.WebRTCExporterStorage.StorageManager).toBeDefined();
    });

    test('should export to globalThis', () => {
      global.globalThis = {};
      
      // Re-load the module
      loadSharedModules();
      
      expect(global.globalThis.WebRTCExporterStorage).toBeDefined();
      expect(global.globalThis.WebRTCExporterStorage.StorageManager).toBeDefined();
    });
  });
});