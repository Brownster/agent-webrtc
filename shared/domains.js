/**
 * Domain management utilities for WebRTC Stats Exporter
 * Centralized domain handling with consistent formatting and validation
 */

// Normalized target domains (no protocol, consistent format)
const TARGET_DOMAINS = [
  'teams.microsoft.com',
  'meet.google.com',
  'awsapps.com',
  'my.connect.aws',
  'mypurecloud.com',
  'genesys.com',
  'mypurecloud.com.au',
  'mypurecloud.ie',
  'mypurecloud.de',
  'mypurecloud.jp',
  'usw2.pure.cloud',
  'cac1.pure.cloud',
  'euw1.pure.cloud'
]

// Domain categories for different handling
const DOMAIN_CATEGORIES = {
  MICROSOFT: ['teams.microsoft.com'],
  GOOGLE: ['meet.google.com'],
  AMAZON: ['awsapps.com', 'my.connect.aws'],
  GENESYS: [
    'mypurecloud.com',
    'genesys.com',
    'mypurecloud.com.au',
    'mypurecloud.ie',
    'mypurecloud.de',
    'mypurecloud.jp',
    'usw2.pure.cloud',
    'cac1.pure.cloud',
    'euw1.pure.cloud'
  ]
}

/**
 * Domain management utility class
 */
class DomainManager {
  /**
   * Check if a URL/hostname is a supported target domain
   * @param {string} url - Full URL or hostname to check
   * @returns {boolean} True if domain is supported
   */
  static isTargetDomain (url) {
    if (!url || typeof url !== 'string') {
      return false
    }

    try {
      const hostname = DomainManager.extractHostname(url)
      return TARGET_DOMAINS.some(domain => hostname.includes(domain))
    } catch (error) {
      console.warn(`[DomainManager] Invalid URL: ${url}`, error)
      return false
    }
  }

  /**
   * Extract hostname from URL or return as-is if already hostname
   * @param {string} url - URL or hostname
   * @returns {string} Normalized hostname
   */
  static extractHostname (url) {
    if (!url) return ''

    // If it's already just a hostname (no protocol), return as-is
    if (!url.includes('://')) {
      return url.toLowerCase()
    }

    try {
      return new URL(url).hostname.toLowerCase()
    } catch (error) {
      // Fallback: try to extract hostname manually
      const match = url.match(/^(?:https?:\/\/)?([^/]+)/)
      return match ? match[1].toLowerCase() : url.toLowerCase()
    }
  }

  /**
   * Extract origin from URL safely
   * @param {string} url - Full URL
   * @returns {string|null} Origin or null if invalid
   */
  static extractOrigin (url) {
    if (!url || typeof url !== 'string') {
      return null
    }

    try {
      return new URL(url).origin
    } catch (error) {
      console.warn(`[DomainManager] Cannot extract origin from: ${url}`, error)
      return null
    }
  }

  /**
   * Normalize URL format for consistent handling
   * @param {string} url - URL to normalize
   * @returns {string} Normalized URL with https protocol
   */
  static normalizeUrl (url) {
    if (!url) return ''

    // Add protocol if missing
    if (!url.includes('://')) {
      url = `https://${url}`
    }

    try {
      const urlObj = new URL(url)
      return urlObj.href
    } catch (error) {
      console.warn(`[DomainManager] Cannot normalize URL: ${url}`, error)
      return url
    }
  }

  /**
   * Get target domains with protocol for UI display
   * @param {string} protocol - Protocol to use (default: https)
   * @returns {string[]} Array of full URLs
   */
  static getTargetDomainsWithProtocol (protocol = 'https') {
    return TARGET_DOMAINS.map(domain => `${protocol}://${domain}`)
  }

  /**
   * Get domain category for a given URL/hostname
   * @param {string} url - URL or hostname
   * @returns {string|null} Category name or null if not found
   */
  static getDomainCategory (url) {
    const hostname = DomainManager.extractHostname(url)

    for (const [category, domains] of Object.entries(DOMAIN_CATEGORIES)) {
      if (domains.some(domain => hostname.includes(domain))) {
        return category
      }
    }

    return null
  }

  /**
   * Validate if URL is well-formed and accessible
   * @param {string} url - URL to validate
   * @returns {Object} { isValid: boolean, error?: string }
   */
  static validateUrl (url) {
    if (!url || typeof url !== 'string') {
      return { isValid: false, error: 'URL is required and must be a string' }
    }

    try {
      const urlObj = new URL(url)

      // Check for valid protocols
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return { isValid: false, error: 'URL must use http or https protocol' }
      }

      // Check for valid hostname
      if (!urlObj.hostname) {
        return { isValid: false, error: 'URL must have a valid hostname' }
      }

      return { isValid: true }
    } catch (error) {
      return { isValid: false, error: `Invalid URL format: ${error.message}` }
    }
  }

  /**
   * Check if domain should be auto-enabled based on settings
   * @param {string} origin - Origin to check
   * @param {Object} enabledOrigins - User's enabled origins settings
   * @returns {boolean} True if should be enabled
   */
  static shouldAutoEnable (origin, enabledOrigins = {}) {
    if (!enabledOrigins || typeof enabledOrigins !== 'object') {
      enabledOrigins = {}
    }

    const isTarget = DomainManager.isTargetDomain(origin)

    // Auto-enable target domains unless explicitly disabled
    if (isTarget) {
      // Check both exact origin match and hostname-based match
      const hostname = DomainManager.extractHostname(origin)

      // Check for exact origin match first
      if (enabledOrigins[origin] === false) {
        return false
      }

      // Check for hostname-based match (e.g., 'teams.microsoft.com')
      if (enabledOrigins[hostname] === false) {
        return false
      }

      // Check for any target domain that matches this hostname
      for (const targetDomain of TARGET_DOMAINS) {
        if (hostname.includes(targetDomain) && enabledOrigins[targetDomain] === false) {
          return false
        }
      }

      return true
    }

    // For non-target domains, only enable if explicitly set
    return enabledOrigins[origin] === true
  }

  /**
   * Get status for domain (for UI display)
   * @param {string} origin - Domain origin
   * @param {Object} enabledOrigins - User settings
   * @returns {Object} { status: string, className: string }
   */
  static getDomainStatus (origin, enabledOrigins = {}) {
    const isTarget = DomainManager.isTargetDomain(origin)
    const explicitSetting = enabledOrigins[origin]

    if (explicitSetting === false) {
      return { status: 'Disabled', className: 'disabled' }
    } else if (explicitSetting === true) {
      return { status: 'Enabled', className: 'enabled' }
    } else if (isTarget) {
      return { status: 'Auto-enabled', className: 'auto-enabled' }
    } else {
      return { status: 'Manual', className: 'manual' }
    }
  }
}

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterDomains = {
    TARGET_DOMAINS,
    DOMAIN_CATEGORIES,
    DomainManager
  }
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterDomains = {
    TARGET_DOMAINS,
    DOMAIN_CATEGORIES,
    DomainManager
  }
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterDomains = {
    TARGET_DOMAINS,
    DOMAIN_CATEGORIES,
    DomainManager
  }
}
