/**
 * Centralized configuration and constants for WebRTC Stats Exporter
 * Single source of truth for all default options and settings
 */

// Default extension options - centralized to eliminate duplication
const DEFAULT_OPTIONS = {
  url: 'http://localhost:9091',
  username: '',
  password: '',
  updateInterval: 2,
  gzip: false,
  job: 'webrtc-internals-exporter',
  agentId: '',
  enabledOrigins: {},
  enabledStats: ['inbound-rtp', 'remote-inbound-rtp', 'outbound-rtp']
}

// Application constants
const CONSTANTS = {
  // Update intervals (milliseconds)
  UPDATE_INTERVALS: {
    DEFAULT: 2000,
    MIN: 1000,
    MAX: 30000,
    CLEANUP_INTERVAL_MINUTES: 1,
    CONNECTION_TIMEOUT_MULTIPLIER: 2
  },

  // Storage keys - centralized to prevent typos
  STORAGE_KEYS: {
    OPTIONS: 'options',
    PEER_CONNECTIONS_PER_ORIGIN: 'peerConnectionsPerOrigin',
    PEER_CONNECTIONS_LAST_UPDATE: 'peerConnectionsLastUpdate',
    MESSAGES_SENT: 'messagesSent',
    BYTES_SENT: 'bytesSent',
    TOTAL_TIME: 'totalTime',
    ERRORS: 'errors'
  },

  // Network and retry configuration
  NETWORK: {
    RETRY_COUNT: 3,
    TIMEOUT_MS: 10000,
    EXPONENTIAL_BACKOFF_BASE: 2,
    MAX_RETRY_DELAY_MS: 30000
  },

  // Logging and debugging
  LOGGING: {
    PREFIX: '[webrtc-internal-exporter',
    DEBUG_STORAGE_KEY: 'webrtc-internal-exporter:debug'
  },

  // Extension lifecycle
  EXTENSION: {
    ALARM_NAME: 'webrtc-internals-exporter-alarm',
    SERVICE_WORKER_KEEPALIVE_INTERVAL: 25000 // 25 seconds
  },

  // WebRTC Stats types - available options
  STATS_TYPES: [
    'candidate-pair',
    'codec',
    'data-channel',
    'inbound-rtp',
    'local-candidate',
    'media-playout',
    'media-source',
    'outbound-rtp',
    'remote-candidate',
    'remote-inbound-rtp',
    'track',
    'transport'
  ],

  // Quality limitation reasons mapping
  QUALITY_LIMITATION_REASONS: {
    none: 0,
    bandwidth: 1,
    cpu: 2,
    other: 3
  },

  // UI Configuration
  UI: {
    SUCCESS_MESSAGE_TIMEOUT: 3000,
    POPUP_UPDATE_INTERVAL: 1000
  }
}

// Version for configuration schema migrations
const CONFIG_VERSION = '1.0.0'

/**
 * Get default options with optional overrides
 * @param {Object} overrides - Options to override defaults
 * @returns {Object} Merged options
 */
function getDefaultOptions (overrides = {}) {
  return { ...DEFAULT_OPTIONS, ...overrides }
}

/**
 * Validate configuration object against schema
 * @param {Object} config - Configuration to validate
 * @returns {Object} { isValid: boolean, errors: string[] }
 */
function validateConfig (config) {
  const errors = []

  if (config.url && typeof config.url !== 'string') {
    errors.push('URL must be a string')
  }

  if (config.updateInterval && (typeof config.updateInterval !== 'number' || config.updateInterval < 1)) {
    errors.push('Update interval must be a positive number')
  }

  if (config.enabledStats && !Array.isArray(config.enabledStats)) {
    errors.push('Enabled stats must be an array')
  }

  if (config.enabledOrigins && typeof config.enabledOrigins !== 'object') {
    errors.push('Enabled origins must be an object')
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterConfig = {
    DEFAULT_OPTIONS,
    CONSTANTS,
    CONFIG_VERSION,
    getDefaultOptions,
    validateConfig
  }
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterConfig = {
    DEFAULT_OPTIONS,
    CONSTANTS,
    CONFIG_VERSION,
    getDefaultOptions,
    validateConfig
  }
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterConfig = {
    DEFAULT_OPTIONS,
    CONSTANTS,
    CONFIG_VERSION,
    getDefaultOptions,
    validateConfig
  }
}
