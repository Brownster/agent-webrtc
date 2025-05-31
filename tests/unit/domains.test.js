/**
 * Unit tests for shared/domains.js
 * Tests domain management and validation utilities
 */

import { describe, test, expect, beforeEach } from '@jest/globals';

describe('Domains Module', () => {
  beforeEach(() => {
    // Clear any existing global objects
    delete global.WebRTCExporterDomains;
    delete global.window;
    delete global.globalThis;
    
    // Load the modules
    loadSharedModules();
  });

  describe('TARGET_DOMAINS', () => {
    test('should have all major platform domains', () => {
      const domains = global.WebRTCExporterDomains.TARGET_DOMAINS;
      
      expect(Array.isArray(domains)).toBe(true);
      expect(domains.length).toBeGreaterThan(5);
      
      // Check for major platforms
      expect(domains).toContain('teams.microsoft.com');
      expect(domains).toContain('meet.google.com');
      expect(domains.some(d => d.includes('mypurecloud'))).toBe(true);
      expect(domains.some(d => d.includes('awsapps'))).toBe(true);
    });

    test('should contain only valid domain formats', () => {
      const domains = global.WebRTCExporterDomains.TARGET_DOMAINS;
      
      domains.forEach(domain => {
        expect(typeof domain).toBe('string');
        expect(domain.length).toBeGreaterThan(0);
        
        // Should not contain protocol
        expect(domain).not.toMatch(/^https?:\/\//);
        
        // Should be a valid domain format
        expect(domain).toMatch(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/);
      });
    });

    test('should not have duplicates', () => {
      const domains = global.WebRTCExporterDomains.TARGET_DOMAINS;
      const uniqueDomains = [...new Set(domains)];
      
      expect(domains.length).toBe(uniqueDomains.length);
    });
  });

  describe('DomainManager', () => {
    let DomainManager;

    beforeEach(() => {
      DomainManager = global.WebRTCExporterDomains.DomainManager;
    });

    describe('isTargetDomain', () => {
      test('should identify target domains correctly', () => {
        expect(DomainManager.isTargetDomain('https://meet.google.com/test-meeting')).toBe(true);
        expect(DomainManager.isTargetDomain('https://teams.microsoft.com/meetings/join')).toBe(true);
        expect(DomainManager.isTargetDomain('https://subdomain.mypurecloud.com/app')).toBe(true);
      });

      test('should reject non-target domains', () => {
        expect(DomainManager.isTargetDomain('https://example.com')).toBe(false);
        expect(DomainManager.isTargetDomain('https://evil-teams.microsoft.com.fake.com')).toBe(false);
        expect(DomainManager.isTargetDomain('https://not-a-target.com')).toBe(false);
      });

      test('should handle invalid URLs gracefully', () => {
        expect(DomainManager.isTargetDomain('')).toBe(false);
        expect(DomainManager.isTargetDomain('not-a-url')).toBe(false);
        expect(DomainManager.isTargetDomain(null)).toBe(false);
        expect(DomainManager.isTargetDomain(undefined)).toBe(false);
      });

      test('should handle various URL formats', () => {
        expect(DomainManager.isTargetDomain('http://meet.google.com')).toBe(true);
        expect(DomainManager.isTargetDomain('https://meet.google.com')).toBe(true);
        expect(DomainManager.isTargetDomain('https://meet.google.com/')).toBe(true);
        expect(DomainManager.isTargetDomain('https://meet.google.com:443/path')).toBe(true);
      });
    });

    describe('extractOrigin', () => {
      test('should extract origin from valid URLs', () => {
        expect(DomainManager.extractOrigin('https://meet.google.com/test')).toBe('https://meet.google.com');
        expect(DomainManager.extractOrigin('http://localhost:3000/app')).toBe('http://localhost:3000');
        expect(DomainManager.extractOrigin('https://teams.microsoft.com:443/join')).toBe('https://teams.microsoft.com');
      });

      test('should handle invalid URLs', () => {
        expect(DomainManager.extractOrigin('')).toBeNull();
        expect(DomainManager.extractOrigin('not-a-url')).toBeNull();
        expect(DomainManager.extractOrigin(null)).toBeNull();
        expect(DomainManager.extractOrigin(undefined)).toBeNull();
      });

      test('should handle edge cases', () => {
        expect(DomainManager.extractOrigin('file:///local/file.html')).toBe('file://');
        expect(DomainManager.extractOrigin('data:text/plain,hello')).toBe('data:');
      });
    });

    describe('shouldAutoEnable', () => {
      test('should auto-enable target domains by default', () => {
        expect(DomainManager.shouldAutoEnable('https://meet.google.com', {})).toBe(true);
        expect(DomainManager.shouldAutoEnable('https://teams.microsoft.com', {})).toBe(true);
      });

      test('should respect explicit disable settings', () => {
        const disabledOrigins = {
          'https://meet.google.com': false
        };
        
        expect(DomainManager.shouldAutoEnable('https://meet.google.com', disabledOrigins)).toBe(false);
        expect(DomainManager.shouldAutoEnable('https://teams.microsoft.com', disabledOrigins)).toBe(true);
      });

      test('should handle explicit enable settings', () => {
        const mixedOrigins = {
          'https://meet.google.com': false,
          'https://teams.microsoft.com': true,
          'https://custom-domain.com': true
        };
        
        expect(DomainManager.shouldAutoEnable('https://meet.google.com', mixedOrigins)).toBe(false);
        expect(DomainManager.shouldAutoEnable('https://teams.microsoft.com', mixedOrigins)).toBe(true);
        expect(DomainManager.shouldAutoEnable('https://custom-domain.com', mixedOrigins)).toBe(true);
      });

      test('should not auto-enable non-target domains', () => {
        expect(DomainManager.shouldAutoEnable('https://example.com', {})).toBe(false);
        
        const enabledOrigins = {
          'https://example.com': true
        };
        expect(DomainManager.shouldAutoEnable('https://example.com', enabledOrigins)).toBe(true);
      });

      test('should handle invalid inputs', () => {
        expect(DomainManager.shouldAutoEnable('', {})).toBe(false);
        expect(DomainManager.shouldAutoEnable('invalid-url', {})).toBe(false);
        expect(DomainManager.shouldAutoEnable('https://meet.google.com', null)).toBe(true);
        expect(DomainManager.shouldAutoEnable('https://meet.google.com', undefined)).toBe(true);
      });
    });

    describe('categorizeOrigin', () => {
      test('should categorize known platforms correctly', () => {
        expect(DomainManager.categorizeOrigin('https://meet.google.com')).toBe('google-meet');
        expect(DomainManager.categorizeOrigin('https://teams.microsoft.com')).toBe('microsoft-teams');
        expect(DomainManager.categorizeOrigin('https://app.mypurecloud.com')).toBe('genesys-cloud');
        expect(DomainManager.categorizeOrigin('https://ccpv2.awsapps.com')).toBe('amazon-connect');
      });

      test('should handle unknown origins', () => {
        expect(DomainManager.categorizeOrigin('https://example.com')).toBe('unknown');
        expect(DomainManager.categorizeOrigin('https://custom-webrtc-app.com')).toBe('unknown');
      });

      test('should handle invalid origins', () => {
        expect(DomainManager.categorizeOrigin('')).toBe('unknown');
        expect(DomainManager.categorizeOrigin('not-a-url')).toBe('unknown');
        expect(DomainManager.categorizeOrigin(null)).toBe('unknown');
      });
    });

    describe('validateUrl', () => {
      test('should validate correct URLs', () => {
        expect(DomainManager.validateUrl('https://meet.google.com')).toBe(true);
        expect(DomainManager.validateUrl('http://localhost:3000')).toBe(true);
        expect(DomainManager.validateUrl('https://subdomain.example.com:8080/path?query=1')).toBe(true);
      });

      test('should reject invalid URLs', () => {
        expect(DomainManager.validateUrl('')).toBe(false);
        expect(DomainManager.validateUrl('not-a-url')).toBe(false);
        expect(DomainManager.validateUrl('ftp://invalid-protocol.com')).toBe(false);
        expect(DomainManager.validateUrl('javascript:alert(1)')).toBe(false);
      });

      test('should only allow http/https protocols', () => {
        expect(DomainManager.validateUrl('https://example.com')).toBe(true);
        expect(DomainManager.validateUrl('http://example.com')).toBe(true);
        expect(DomainManager.validateUrl('ftp://example.com')).toBe(false);
        expect(DomainManager.validateUrl('file:///local/file')).toBe(false);
        expect(DomainManager.validateUrl('data:text/plain,test')).toBe(false);
      });

      test('should handle null and undefined', () => {
        expect(DomainManager.validateUrl(null)).toBe(false);
        expect(DomainManager.validateUrl(undefined)).toBe(false);
      });
    });
  });

  describe('Global Export', () => {
    test('should export to window in browser environment', () => {
      global.window = {};
      
      // Re-load the module
      loadSharedModules();
      
      expect(global.window.WebRTCExporterDomains).toBeDefined();
      expect(global.window.WebRTCExporterDomains.TARGET_DOMAINS).toBeDefined();
      expect(global.window.WebRTCExporterDomains.DomainManager).toBeDefined();
    });

    test('should export to globalThis', () => {
      global.globalThis = {};
      
      // Re-load the module
      loadSharedModules();
      
      expect(global.globalThis.WebRTCExporterDomains).toBeDefined();
      expect(global.globalThis.WebRTCExporterDomains.DomainManager).toBeDefined();
    });
  });
});