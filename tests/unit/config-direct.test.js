/**
 * Tests for config module using direct approach
 */

const configModule = require('../modules/config-direct');

describe('Config Module (Direct)', () => {
  describe('DEFAULT_OPTIONS', () => {
    test('should have all required default options', () => {
      expect(configModule.DEFAULT_OPTIONS).toBeDefined();
      expect(configModule.DEFAULT_OPTIONS.url).toBe("http://localhost:9091");
      expect(configModule.DEFAULT_OPTIONS.username).toBe("");
      expect(configModule.DEFAULT_OPTIONS.password).toBe("");
      expect(configModule.DEFAULT_OPTIONS.updateInterval).toBe(2);
      expect(configModule.DEFAULT_OPTIONS.gzip).toBe(false);
      expect(configModule.DEFAULT_OPTIONS.job).toBe("webrtc-internals-exporter");
      expect(configModule.DEFAULT_OPTIONS.agentId).toBe("");
      expect(configModule.DEFAULT_OPTIONS.useProxy).toBe(false);
      expect(configModule.DEFAULT_OPTIONS.proxyUrl).toBe("");
      expect(configModule.DEFAULT_OPTIONS.apiKey).toBe("");
      expect(configModule.DEFAULT_OPTIONS.enabledOrigins).toEqual({});
      expect(Array.isArray(configModule.DEFAULT_OPTIONS.enabledStats)).toBe(true);
    });

    test('should have valid enabled stats array', () => {
      expect(configModule.DEFAULT_OPTIONS.enabledStats).toContain("inbound-rtp");
      expect(configModule.DEFAULT_OPTIONS.enabledStats).toContain("outbound-rtp");
    });
  });

  describe('CONSTANTS', () => {
    test('should define application constants', () => {
      expect(configModule.CONSTANTS).toBeDefined();
      expect(typeof configModule.CONSTANTS).toBe('object');
    });
  });

  describe('CONFIG_VERSION', () => {
    test('should have a version string', () => {
      expect(configModule.CONFIG_VERSION).toBeDefined();
      expect(typeof configModule.CONFIG_VERSION).toBe('string');
      expect(configModule.CONFIG_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('getDefaultOptions', () => {
    test('should return default options', () => {
      const defaults = configModule.getDefaultOptions();
      expect(defaults).toEqual(configModule.DEFAULT_OPTIONS);
    });

    test('should return a copy, not the original object', () => {
      const defaults1 = configModule.getDefaultOptions();
      const defaults2 = configModule.getDefaultOptions();
      expect(defaults1).not.toBe(defaults2);
      expect(defaults1).toEqual(defaults2);
    });
  });

  describe('validateConfig', () => {
    test('should validate valid config', () => {
      const validConfig = {
        url: "http://localhost:9091",
        username: "user",
        password: "pass",
        updateInterval: 5,
        gzip: true,
        job: "test-job",
        agentId: "agent123",
        enabledOrigins: { "https://example.com": true },
        enabledStats: ["inbound-rtp"]
      };

      const result = configModule.validateConfig(validConfig);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('should reject config with invalid URL', () => {
      const invalidConfig = {
        url: 123,
        username: "user",
        password: "pass",
        updateInterval: 5
      };

      const result = configModule.validateConfig(invalidConfig);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('URL must be a string');
    });

    test('should reject config with invalid update interval', () => {
      const invalidConfig = {
        url: "http://localhost:9091",
        updateInterval: -1
      };

      const result = configModule.validateConfig(invalidConfig);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Update interval must be a positive number');
    });

    test('should reject config with invalid enabled stats', () => {
      const invalidConfig = {
        url: "http://localhost:9091",
        enabledStats: "not-an-array"
      };

      const result = configModule.validateConfig(invalidConfig);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Enabled stats must be an array');
    });
  });
});
