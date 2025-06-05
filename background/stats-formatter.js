/**
 * Stats Formatter Module for WebRTC Stats Exporter
 * Handles conversion of WebRTC stats to Prometheus text format
 */

/**
 * StatsFormatter class for converting WebRTC stats to Prometheus format
 */
class StatsFormatter {
  /**
   * Format WebRTC stats into Prometheus text format
   * @param {Object} params - Formatting parameters
   * @param {string} params.url - Page URL for labeling
   * @param {string} params.state - RTCPeerConnection state
   * @param {Array} params.values - WebRTC stats values
   * @param {string} [params.agentId] - Optional agent ID for labeling
   * @returns {string} Prometheus text format data
   */
  static formatStats ({ url, state, values, agentId }) {
    if (!values || !Array.isArray(values) || values.length === 0) {
      return ''
    }

    let data = ''
    const sentTypes = new Set()

    values.forEach((value) => {
      const type = value.type.replace(/-/g, '_')
      const labels = [`pageUrl="${url}"`]
      const metrics = []

      // Add agent_id label if configured
      if (agentId) {
        labels.push(`agent_id="${agentId}"`)
      }

      // Add state label for peer-connection type
      if (value.type === 'peer-connection') {
        labels.push(`state="${state}"`)
      }

      // Process value properties into metrics and labels
      Object.entries(value).forEach(([key, v]) => {
        if (typeof v === 'number') {
          metrics.push([key, v])
        } else if (typeof v === 'object' && v !== null) {
          // Handle nested objects by flattening them
          Object.entries(v).forEach(([subkey, subv]) => {
            if (typeof subv === 'number') {
              metrics.push([`${key}_${subkey}`, subv])
            }
          })
        } else if (key === 'qualityLimitationReason') {
          // Convert quality limitation reason to numeric value
          const numericValue = StatsFormatter.getQualityLimitationValue(v)
          if (numericValue !== undefined) {
            metrics.push([key, numericValue])
          }
        } else if (key === 'googTimingFrameInfo') {
          // googTimingFrameInfo contains verbose timing details that are
          // specific to Chrome's implementation. These values are skipped to
          // avoid emitting non-standard metrics.
        } else if (typeof v === 'string' || typeof v === 'boolean') {
          // Convert non-numeric values to labels
          labels.push(`${key}="${v}"`)
        }
      })

      // Generate Prometheus metrics lines
      metrics.forEach(([key, v]) => {
        const name = `${type}_${key.replace(/-/g, '_')}`
        let typeDesc = ''

        // Add TYPE declaration for new metric names
        if (!sentTypes.has(name)) {
          typeDesc = `# TYPE ${name} gauge\n`
          sentTypes.add(name)
        }

        data += `${typeDesc}${name}{${labels.join(',')}} ${v}\n`
      })
    })

    return data
  }

  /**
   * Get numeric value for quality limitation reason
   * @param {string} reason - Quality limitation reason
   * @returns {number|undefined} Numeric value or undefined if unknown
   */
  static getQualityLimitationValue (reason) {
    // Use shared config if available, otherwise use hardcoded mapping
    const config = globalThis.WebRTCExporterConfig || self.WebRTCExporterConfig
    if (config && config.CONSTANTS.QUALITY_LIMITATION_REASONS) {
      return config.CONSTANTS.QUALITY_LIMITATION_REASONS[reason]
    }

    // Fallback mapping
    const mapping = {
      none: 0,
      bandwidth: 1,
      cpu: 2,
      other: 3
    }
    return mapping[reason]
  }

  /**
   * Validate stats values array
   * @param {Array} values - Stats values to validate
   * @returns {Object} { isValid: boolean, errors: string[] }
   */
  static validateStats (values) {
    const errors = []

    if (!Array.isArray(values)) {
      errors.push('Values must be an array')
      return { isValid: false, errors }
    }

    values.forEach((value, index) => {
      if (!value || typeof value !== 'object') {
        errors.push(`Value at index ${index} must be an object`)
      } else if (!value.type || typeof value.type !== 'string') {
        errors.push(`Value at index ${index} must have a string 'type' property`)
      }
    })

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Normalize metric name for Prometheus format
   * @param {string} name - Raw metric name
   * @returns {string} Normalized metric name
   */
  static normalizeMetricName (name) {
    if (typeof name !== 'string') {
      return 'unknown'
    }
    return name.replace(/-/g, '_').toLowerCase()
  }

  /**
   * Escape label value for Prometheus format
   * @param {string} value - Label value to escape
   * @returns {string} Escaped label value
   */
  static escapeLabelValue (value) {
    if (typeof value !== 'string') {
      return String(value)
    }
    // Escape backslashes, quotes, and newlines
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
  }

  /**
   * Get supported WebRTC stats types
   * @returns {string[]} Array of supported stats types
   */
  static getSupportedStatsTypes () {
    const config = globalThis.WebRTCExporterConfig || self.WebRTCExporterConfig
    if (config && config.CONSTANTS.STATS_TYPES) {
      return [...config.CONSTANTS.STATS_TYPES, 'peer-connection']
    }

    // Fallback list
    return [
      'candidate-pair',
      'codec',
      'data-channel',
      'inbound-rtp',
      'local-candidate',
      'media-playout',
      'media-source',
      'outbound-rtp',
      'peer-connection',
      'remote-candidate',
      'remote-inbound-rtp',
      'track',
      'transport'
    ]
  }
}

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterStatsFormatter = { StatsFormatter }
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterStatsFormatter = { StatsFormatter }
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterStatsFormatter = { StatsFormatter }
}
