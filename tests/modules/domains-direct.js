/**
 * Direct import approach for domains.js with coverage
 */

// Mock browser globals
global.globalThis = global.globalThis || global;

// Normalized target domains (no protocol, consistent format)
const TARGET_DOMAINS = [
  "teams.microsoft.com",
  "meet.google.com", 
  "awsapps.com",
  "my.connect.aws",
  "mypurecloud.com",
  "genesys.com",
  "mypurecloud.com.au",
  "mypurecloud.ie", 
  "mypurecloud.de",
  "mypurecloud.jp",
  "usw2.pure.cloud",
  "cac1.pure.cloud", 
  "euw1.pure.cloud"
];

// Domain categories for different handling
const DOMAIN_CATEGORIES = {
  MICROSOFT: ["teams.microsoft.com"],
  GOOGLE: ["meet.google.com"],
  AMAZON: ["awsapps.com", "my.connect.aws"],
  GENESYS: [
    "mypurecloud.com",
    "genesys.com", 
    "mypurecloud.com.au",
    "mypurecloud.ie",
    "mypurecloud.de", 
    "mypurecloud.jp",
    "usw2.pure.cloud",
    "cac1.pure.cloud",
    "euw1.pure.cloud"
  ],
};

/**
 * Domain management utility class
 */
class DomainManager {
  /**
   * Check if a URL/hostname is a supported target domain
   * @param {string} url - Full URL or hostname to check
   * @returns {boolean} True if domain is supported
   */
  static isTargetDomain(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }
    
    try {
      const hostname = DomainManager.extractHostname(url);
      return TARGET_DOMAINS.some(domain => hostname.includes(domain));
    } catch (error) {
      console.warn(`[DomainManager] Invalid URL: ${url}`, error);
      return false;
    }
  }
  
  /**
   * Extract hostname from URL or return as-is if already hostname
   * @param {string} url - URL or hostname
   * @returns {string} Normalized hostname
   */
  static extractHostname(url) {
    if (!url || typeof url !== 'string') {
      return '';
    }
    
    try {
      // Try URL constructor first
      return new URL(url).hostname.toLowerCase();
    } catch (error) {
      // Fallback: try to extract hostname manually
      const match = url.match(/^(?:https?:\/\/)?([^\/]+)/);
      return match ? match[1].toLowerCase() : url.toLowerCase();
    }
  }
  
  /**
   * Extract origin from URL safely
   * @param {string} url - Full URL
   * @returns {string|null} Origin or null if invalid
   */
  static extractOrigin(url) {
    if (!url || typeof url !== 'string') {
      return null;
    }
    
    try {
      return new URL(url).origin;
    } catch (error) {
      console.warn(`[DomainManager] Cannot extract origin from: ${url}`, error);
      return null;
    }
  }
  
  /**
   * Normalize URL format for consistent handling
   * @param {string} url - URL to normalize
   * @returns {string} Normalized URL with https protocol
   */
  static normalizeUrl(url) {
    if (!url || typeof url !== 'string') {
      return '';
    }
    
    try {
      // Add https if no protocol specified
      if (!url.match(/^https?:\/\//)) {
        url = `https://${url}`;
      }
      
      const urlObj = new URL(url);
      return urlObj.origin;
    } catch (error) {
      console.warn(`[DomainManager] Cannot normalize URL: ${url}`, error);
      return '';
    }
  }
  
  /**
   * Get domain category for a given hostname
   * @param {string} hostname - Hostname to categorize
   * @returns {string|null} Category name or null if not found
   */
  static getDomainCategory(hostname) {
    if (!hostname || typeof hostname !== 'string') {
      return null;
    }
    
    const normalizedHostname = hostname.toLowerCase();
    
    for (const [category, domains] of Object.entries(DOMAIN_CATEGORIES)) {
      if (domains.some(domain => normalizedHostname.includes(domain))) {
        return category;
      }
    }
    
    return null;
  }
  
  /**
   * Check if origin should be auto-enabled based on domain rules
   * @param {string} origin - Origin to check
   * @returns {boolean} True if should be auto-enabled
   */
  static shouldAutoEnable(origin) {
    if (!origin || typeof origin !== 'string') {
      return false;
    }
    
    try {
      const hostname = new URL(origin).hostname;
      return DomainManager.isTargetDomain(hostname);
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Get all supported target domains
   * @returns {string[]} Array of target domains
   */
  static getTargetDomains() {
    return [...TARGET_DOMAINS];
  }
  
  /**
   * Get domain categories
   * @returns {Object} Domain categories object
   */
  static getDomainCategories() {
    return { ...DOMAIN_CATEGORIES };
  }
}

// Export configuration class for Chrome extension messaging
class TARGET_DOMAINS_CONFIG {
  static get domains() {
    return TARGET_DOMAINS;
  }
  
  static get categories() {
    return DOMAIN_CATEGORIES;
  }
  
  static isTargetDomain(domain) {
    return DomainManager.isTargetDomain(domain);
  }
}

// Global export for browser compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterDomains = {
    TARGET_DOMAINS,
    DOMAIN_CATEGORIES,
    DomainManager,
    TARGET_DOMAINS_CONFIG,
  };
}

module.exports = {
  TARGET_DOMAINS,
  DOMAIN_CATEGORIES,
  DomainManager,
  TARGET_DOMAINS_CONFIG,
};
