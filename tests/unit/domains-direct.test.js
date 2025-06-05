/**
 * Tests for domains module using direct approach
 */

const domainsModule = require('../modules/domains-direct');

describe('Domains Module (Direct)', () => {
  describe('TARGET_DOMAINS', () => {
    test('should be an array of target domains', () => {
      expect(Array.isArray(domainsModule.TARGET_DOMAINS)).toBe(true);
      expect(domainsModule.TARGET_DOMAINS.length).toBeGreaterThan(0);
    });

    test('should contain expected domains', () => {
      const domains = domainsModule.TARGET_DOMAINS;
      
      // Should contain Microsoft Teams
      expect(domains).toContain('teams.microsoft.com');
      
      // Should contain Google Meet  
      expect(domains).toContain('meet.google.com');
    });

    test('should have valid domain patterns', () => {
      domainsModule.TARGET_DOMAINS.forEach(domain => {
        expect(typeof domain).toBe('string');
        expect(domain.length).toBeGreaterThan(0);
        
        // Should be valid domain patterns (contain domain parts)
        expect(domain).toMatch(/[a-zA-Z0-9.-]+/);
      });
    });
  });

  describe('DOMAIN_CATEGORIES', () => {
    test('should have categorized domains', () => {
      expect(domainsModule.DOMAIN_CATEGORIES).toBeDefined();
      expect(typeof domainsModule.DOMAIN_CATEGORIES).toBe('object');
      
      expect(domainsModule.DOMAIN_CATEGORIES.MICROSOFT).toContain('teams.microsoft.com');
      expect(domainsModule.DOMAIN_CATEGORIES.GOOGLE).toContain('meet.google.com');
    });
  });

  describe('DomainManager', () => {
    test('should be defined', () => {
      expect(domainsModule.DomainManager).toBeDefined();
      expect(typeof domainsModule.DomainManager).toBe('function');
    });

    describe('isTargetDomain (static)', () => {
      test('should identify target domains', () => {
        expect(domainsModule.DomainManager.isTargetDomain('teams.microsoft.com')).toBe(true);
        expect(domainsModule.DomainManager.isTargetDomain('meet.google.com')).toBe(true);
      });

      test('should reject non-target domains', () => {
        expect(domainsModule.DomainManager.isTargetDomain('example.com')).toBe(false);
        expect(domainsModule.DomainManager.isTargetDomain('malicious-site.com')).toBe(false);
      });

      test('should handle edge cases', () => {
        expect(domainsModule.DomainManager.isTargetDomain('')).toBe(false);
        expect(domainsModule.DomainManager.isTargetDomain(null)).toBe(false);
        expect(domainsModule.DomainManager.isTargetDomain(undefined)).toBe(false);
      });
    });

    describe('extractOrigin (static)', () => {
      test('should extract origin from valid URLs', () => {
        expect(domainsModule.DomainManager.extractOrigin('https://teams.microsoft.com/path')).toBe('https://teams.microsoft.com');
        expect(domainsModule.DomainManager.extractOrigin('https://meet.google.com/abc-def-ghi')).toBe('https://meet.google.com');
      });

      test('should handle URLs without paths', () => {
        expect(domainsModule.DomainManager.extractOrigin('https://teams.microsoft.com')).toBe('https://teams.microsoft.com');
      });

      test('should handle different protocols', () => {
        expect(domainsModule.DomainManager.extractOrigin('http://localhost:3000')).toBe('http://localhost:3000');
      });

      test('should return null for invalid URLs', () => {
        expect(domainsModule.DomainManager.extractOrigin('invalid-url')).toBe(null);
        expect(domainsModule.DomainManager.extractOrigin('')).toBe(null);
        expect(domainsModule.DomainManager.extractOrigin(null)).toBe(null);
      });
    });

    describe('extractHostname (static)', () => {
      test('should extract hostname from URLs', () => {
        expect(domainsModule.DomainManager.extractHostname('https://teams.microsoft.com/path')).toBe('teams.microsoft.com');
        expect(domainsModule.DomainManager.extractHostname('https://meet.google.com:443/room')).toBe('meet.google.com');
      });

      test('should handle hostnames without protocol', () => {
        expect(domainsModule.DomainManager.extractHostname('teams.microsoft.com')).toBe('teams.microsoft.com');
      });

      test('should handle invalid inputs', () => {
        expect(domainsModule.DomainManager.extractHostname('')).toBe('');
        expect(domainsModule.DomainManager.extractHostname(null)).toBe('');
      });
    });

    describe('normalizeUrl (static)', () => {
      test('should normalize URLs with https protocol', () => {
        expect(domainsModule.DomainManager.normalizeUrl('teams.microsoft.com')).toBe('https://teams.microsoft.com');
        expect(domainsModule.DomainManager.normalizeUrl('http://teams.microsoft.com')).toBe('http://teams.microsoft.com');
      });

      test('should handle invalid URLs', () => {
        expect(domainsModule.DomainManager.normalizeUrl('')).toBe('');
        expect(domainsModule.DomainManager.normalizeUrl(null)).toBe('');
      });
    });

    describe('getDomainCategory (static)', () => {
      test('should categorize known domains', () => {
        expect(domainsModule.DomainManager.getDomainCategory('teams.microsoft.com')).toBe('MICROSOFT');
        expect(domainsModule.DomainManager.getDomainCategory('meet.google.com')).toBe('GOOGLE');
      });

      test('should return null for unknown domains', () => {
        expect(domainsModule.DomainManager.getDomainCategory('example.com')).toBe(null);
        expect(domainsModule.DomainManager.getDomainCategory('')).toBe(null);
      });
    });

    describe('shouldAutoEnable (static)', () => {
      test('should auto-enable known target domains', () => {
        expect(domainsModule.DomainManager.shouldAutoEnable('https://teams.microsoft.com')).toBe(true);
        expect(domainsModule.DomainManager.shouldAutoEnable('https://meet.google.com')).toBe(true);
      });

      test('should not auto-enable non-target domains', () => {
        expect(domainsModule.DomainManager.shouldAutoEnable('https://example.com')).toBe(false);
      });

      test('should handle invalid origins', () => {
        expect(domainsModule.DomainManager.shouldAutoEnable(null)).toBe(false);
        expect(domainsModule.DomainManager.shouldAutoEnable('')).toBe(false);
      });
    });

    describe('getTargetDomains (static)', () => {
      test('should return copy of target domains', () => {
        const domains = domainsModule.DomainManager.getTargetDomains();
        expect(Array.isArray(domains)).toBe(true);
        expect(domains).toEqual(domainsModule.TARGET_DOMAINS);
        expect(domains).not.toBe(domainsModule.TARGET_DOMAINS); // Should be a copy
      });
    });

    describe('getDomainCategories (static)', () => {
      test('should return copy of domain categories', () => {
        const categories = domainsModule.DomainManager.getDomainCategories();
        expect(typeof categories).toBe('object');
        expect(categories).toEqual(domainsModule.DOMAIN_CATEGORIES);
        expect(categories).not.toBe(domainsModule.DOMAIN_CATEGORIES); // Should be a copy
      });
    });
  });

  describe('TARGET_DOMAINS_CONFIG', () => {
    test('should provide configuration interface', () => {
      expect(domainsModule.TARGET_DOMAINS_CONFIG).toBeDefined();
      expect(typeof domainsModule.TARGET_DOMAINS_CONFIG).toBe('function');
    });

    test('should provide domain access', () => {
      expect(domainsModule.TARGET_DOMAINS_CONFIG.domains).toEqual(domainsModule.TARGET_DOMAINS);
      expect(domainsModule.TARGET_DOMAINS_CONFIG.categories).toEqual(domainsModule.DOMAIN_CATEGORIES);
    });

    test('should provide isTargetDomain method', () => {
      expect(domainsModule.TARGET_DOMAINS_CONFIG.isTargetDomain('teams.microsoft.com')).toBe(true);
      expect(domainsModule.TARGET_DOMAINS_CONFIG.isTargetDomain('example.com')).toBe(false);
    });
  });
});
