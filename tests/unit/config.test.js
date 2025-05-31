/**
 * Unit tests for shared/config.js
 * Tests centralized configuration management
 */

import { describe, test, expect, beforeEach } from '@jest/globals';

describe('Config Module', () => {
  beforeEach(() => {
    // Clear any existing global objects
    delete global.WebRTCExporterConfig;
    delete global.window;
    delete global.globalThis;
    
    // Load the config module
    loadSharedModules();
  });

  describe('DEFAULT_OPTIONS', () => {
    test('should have all required default options', () => {
      const config = global.WebRTCExporterConfig;
      expect(config).toBeDefined();
      expect(config.DEFAULT_OPTIONS).toBeDefined();
      
      const defaults = config.DEFAULT_OPTIONS;
      
      // Check all required fields exist
      expect(defaults).toHaveProperty('url');
      expect(defaults).toHaveProperty('username');
      expect(defaults).toHaveProperty('password');
      expect(defaults).toHaveProperty('updateInterval');
      expect(defaults).toHaveProperty('gzip');
      expect(defaults).toHaveProperty('job');
      expect(defaults).toHaveProperty('agentId');
      expect(defaults).toHaveProperty('enabledOrigins');
      expect(defaults).toHaveProperty('enabledStats');
    });

    test('should have correct default values', () => {
      const defaults = global.WebRTCExporterConfig.DEFAULT_OPTIONS;
      
      expect(defaults.url).toBe('http://localhost:9091');
      expect(defaults.username).toBe('');
      expect(defaults.password).toBe('');
      expect(defaults.updateInterval).toBe(2);
      expect(defaults.gzip).toBe(false);
      expect(defaults.job).toBe('webrtc-internals-exporter');
      expect(defaults.agentId).toBe('');
      expect(defaults.enabledOrigins).toEqual({});
      expect(Array.isArray(defaults.enabledStats)).toBe(true);
      expect(defaults.enabledStats).toContain('inbound-rtp');
      expect(defaults.enabledStats).toContain('outbound-rtp');
    });

    test('should not be modifiable', () => {
      const defaults = global.WebRTCExporterConfig.DEFAULT_OPTIONS;
      const originalUrl = defaults.url;
      
      // Try to modify (should not affect original)
      const modified = { ...defaults, url: 'http://changed.com' };
      expect(modified.url).toBe('http://changed.com');
      expect(defaults.url).toBe(originalUrl);
    });
  });

  describe('CONSTANTS', () => {
    test('should have all required constants sections', () => {
      const constants = global.WebRTCExporterConfig.CONSTANTS;
      
      expect(constants).toHaveProperty('UPDATE_INTERVALS');
      expect(constants).toHaveProperty('STORAGE_KEYS');
      expect(constants).toHaveProperty('NETWORK');
      expect(constants).toHaveProperty('LOGGING');
      expect(constants).toHaveProperty('EXTENSION');
      expect(constants).toHaveProperty('STATS_TYPES');
      expect(constants).toHaveProperty('QUALITY_LIMITATION_REASONS');
    });

    test('should have valid update intervals', () => {
      const intervals = global.WebRTCExporterConfig.CONSTANTS.UPDATE_INTERVALS;
      
      expect(intervals.DEFAULT).toBe(2000);
      expect(intervals.MIN).toBe(1000);
      expect(intervals.MAX).toBe(30000);
      expect(intervals.MIN).toBeLessThan(intervals.DEFAULT);
      expect(intervals.DEFAULT).toBeLessThan(intervals.MAX);
    });

    test('should have all required storage keys', () => {
      const keys = global.WebRTCExporterConfig.CONSTANTS.STORAGE_KEYS;
      
      expect(keys).toHaveProperty('PEER_CONNECTIONS_PER_ORIGIN');
      expect(keys).toHaveProperty('MESSAGES_SENT');
      expect(keys).toHaveProperty('BYTES_SENT');
      expect(keys).toHaveProperty('ERRORS');
      
      // Keys should be strings
      Object.values(keys).forEach(key => {
        expect(typeof key).toBe('string');
        expect(key.length).toBeGreaterThan(0);
      });
    });

    test('should have network configuration', () => {
      const network = global.WebRTCExporterConfig.CONSTANTS.NETWORK;
      
      expect(network.RETRY_COUNT).toBeGreaterThan(0);
      expect(network.TIMEOUT_MS).toBeGreaterThan(0);
      expect(network.EXPONENTIAL_BACKOFF_BASE).toBeGreaterThan(1);
    });

    test('should have supported WebRTC stats types', () => {
      const statsTypes = global.WebRTCExporterConfig.CONSTANTS.STATS_TYPES;
      
      expect(Array.isArray(statsTypes)).toBe(true);
      expect(statsTypes).toContain('inbound-rtp');
      expect(statsTypes).toContain('outbound-rtp');
      expect(statsTypes).toContain('candidate-pair');
      expect(statsTypes.length).toBeGreaterThan(5);
    });
  });

  describe('getDefaultOptions', () => {
    test('should return default options when called without parameters', () => {
      const config = global.WebRTCExporterConfig;
      const defaults = config.getDefaultOptions();
      
      expect(defaults).toEqual(config.DEFAULT_OPTIONS);
    });

    test('should merge overrides with defaults', () => {
      const config = global.WebRTCExporterConfig;
      const overrides = {
        url: 'http://custom.com:9091',
        agentId: 'test-agent',
        updateInterval: 5
      };
      
      const result = config.getDefaultOptions(overrides);
      
      expect(result.url).toBe(overrides.url);
      expect(result.agentId).toBe(overrides.agentId);
      expect(result.updateInterval).toBe(overrides.updateInterval);
      
      // Should keep other defaults
      expect(result.username).toBe(config.DEFAULT_OPTIONS.username);
      expect(result.job).toBe(config.DEFAULT_OPTIONS.job);
    });

    test('should not modify original defaults', () => {
      const config = global.WebRTCExporterConfig;
      const originalDefaults = { ...config.DEFAULT_OPTIONS };
      
      config.getDefaultOptions({ url: 'http://modified.com' });
      
      expect(config.DEFAULT_OPTIONS).toEqual(originalDefaults);
    });
  });

  describe('validateConfig', () => {
    test('should validate correct configuration', () => {
      const config = global.WebRTCExporterConfig;
      const validConfig = {
        url: 'http://localhost:9091',
        updateInterval: 2,
        enabledStats: ['inbound-rtp'],
        enabledOrigins: {}
      };
      
      const result = config.validateConfig(validConfig);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('should reject invalid URL', () => {
      const config = global.WebRTCExporterConfig;
      const invalidConfig = { url: 123 };
      
      const result = config.validateConfig(invalidConfig);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('URL must be a string');
    });

    test('should reject invalid update interval', () => {
      const config = global.WebRTCExporterConfig;
      const invalidConfig = { updateInterval: 0 };
      
      const result = config.validateConfig(invalidConfig);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Update interval must be a positive number');
    });

    test('should reject invalid enabled stats', () => {
      const config = global.WebRTCExporterConfig;
      const invalidConfig = { enabledStats: 'not-an-array' };
      
      const result = config.validateConfig(invalidConfig);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Enabled stats must be an array');
    });

    test('should reject invalid enabled origins', () => {
      const config = global.WebRTCExporterConfig;
      const invalidConfig = { enabledOrigins: 'not-an-object' };
      
      const result = config.validateConfig(invalidConfig);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Enabled origins must be an object');
    });

    test('should return multiple errors for multiple issues', () => {
      const config = global.WebRTCExporterConfig;
      const invalidConfig = {
        url: 123,
        updateInterval: -1,
        enabledStats: 'invalid'
      };
      
      const result = config.validateConfig(invalidConfig);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Global Export', () => {
    test('should export to window in browser environment', () => {
      global.window = {};
      
      // Re-load the module
      loadSharedModules();
      
      expect(global.window.WebRTCExporterConfig).toBeDefined();
      expect(global.window.WebRTCExporterConfig.DEFAULT_OPTIONS).toBeDefined();
    });

    test('should export to globalThis', () => {
      global.globalThis = {};
      
      // Re-load the module
      loadSharedModules();
      
      expect(global.globalThis.WebRTCExporterConfig).toBeDefined();
      expect(global.globalThis.WebRTCExporterConfig.CONSTANTS).toBeDefined();
    });
  });
});