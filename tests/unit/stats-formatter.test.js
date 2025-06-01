/**
 * Unit tests for StatsFormatter module
 */

const fs = require('fs')
const path = require('path')

describe('StatsFormatter', () => {
  let StatsFormatter

  beforeAll(() => {
    // Load the stats formatter module directly
    const modulePath = path.join(__dirname, '../../background/stats-formatter.js')
    const moduleCode = fs.readFileSync(modulePath, 'utf8')
    
    // Execute the module code in global context
    const moduleFunction = new Function('global', 'globalThis', 'self', 'window', 'console', moduleCode)
    moduleFunction(global, global, global, global, console)
    
    // Get the exported class
    StatsFormatter = global.WebRTCExporterStatsFormatter.StatsFormatter
  })

  describe('formatStats', () => {
    test('should return empty string for empty values array', () => {
      const result = StatsFormatter.formatStats({
        url: 'https://example.com',
        state: 'connected',
        values: []
      })
      expect(result).toBe('')
    })

    test('should return empty string for null/undefined values', () => {
      const result1 = StatsFormatter.formatStats({
        url: 'https://example.com',
        state: 'connected',
        values: null
      })
      expect(result1).toBe('')

      const result2 = StatsFormatter.formatStats({
        url: 'https://example.com',
        state: 'connected',
        values: undefined
      })
      expect(result2).toBe('')
    })

    test('should format basic WebRTC stats correctly', () => {
      const values = [
        {
          type: 'inbound-rtp',
          ssrc: 123456,
          packetsReceived: 1000,
          bytesReceived: 50000,
          mediaType: 'audio'
        }
      ]

      const result = StatsFormatter.formatStats({
        url: 'https://teams.microsoft.com/call',
        state: 'connected',
        values
      })

      expect(result).toContain('# TYPE inbound_rtp_ssrc gauge')
      expect(result).toContain('inbound_rtp_ssrc{pageUrl="https://teams.microsoft.com/call",type="inbound-rtp",mediaType="audio"} 123456')
      expect(result).toContain('inbound_rtp_packetsReceived{pageUrl="https://teams.microsoft.com/call",type="inbound-rtp",mediaType="audio"} 1000')
      expect(result).toContain('inbound_rtp_bytesReceived{pageUrl="https://teams.microsoft.com/call",type="inbound-rtp",mediaType="audio"} 50000')
    })

    test('should include agent_id label when provided', () => {
      const values = [
        {
          type: 'outbound-rtp',
          packetsSent: 500
        }
      ]

      const result = StatsFormatter.formatStats({
        url: 'https://meet.google.com',
        state: 'connected',
        values,
        agentId: 'agent-123'
      })

      expect(result).toContain('agent_id="agent-123"')
      expect(result).toContain('outbound_rtp_packetsSent{pageUrl="https://meet.google.com",agent_id="agent-123",type="outbound-rtp"} 500')
    })

    test('should handle peer-connection type with state label', () => {
      const values = [
        {
          type: 'peer-connection',
          currentRoundTripTime: 0.05
        }
      ]

      const result = StatsFormatter.formatStats({
        url: 'https://example.com',
        state: 'connected',
        values
      })

      expect(result).toContain('state="connected"')
      expect(result).toContain('peer_connection_currentRoundTripTime{pageUrl="https://example.com",state="connected",type="peer-connection"} 0.05')
    })

    test('should handle nested object properties', () => {
      const values = [
        {
          type: 'candidate-pair',
          currentRoundTripTime: 0.1,
          availableOutgoingBitrate: 1000000,
          requestsReceived: {
            total: 10,
            successful: 9
          }
        }
      ]

      const result = StatsFormatter.formatStats({
        url: 'https://example.com',
        state: 'connected',
        values
      })

      expect(result).toContain('candidate_pair_requestsReceived_total{pageUrl="https://example.com",type="candidate-pair"} 10')
      expect(result).toContain('candidate_pair_requestsReceived_successful{pageUrl="https://example.com",type="candidate-pair"} 9')
      expect(result).toContain('candidate_pair_currentRoundTripTime{pageUrl="https://example.com",type="candidate-pair"} 0.1')
    })

    test('should handle quality limitation reasons', () => {
      const values = [
        {
          type: 'outbound-rtp',
          qualityLimitationReason: 'bandwidth',
          framesSent: 1000
        }
      ]

      const result = StatsFormatter.formatStats({
        url: 'https://example.com',
        state: 'connected',
        values
      })

      expect(result).toContain('outbound_rtp_qualityLimitationReason{pageUrl="https://example.com",type="outbound-rtp"} 1')
      expect(result).toContain('outbound_rtp_framesSent{pageUrl="https://example.com",type="outbound-rtp"} 1000')
    })

    test('should generate TYPE declarations only once per metric', () => {
      const values = [
        {
          type: 'inbound-rtp',
          packetsReceived: 1000
        },
        {
          type: 'inbound-rtp',
          packetsReceived: 2000
        }
      ]

      const result = StatsFormatter.formatStats({
        url: 'https://example.com',
        state: 'connected',
        values
      })

      const typeDeclarations = result.match(/# TYPE inbound_rtp_packetsReceived gauge/g)
      expect(typeDeclarations).toHaveLength(1)
    })

    test('should handle boolean and string values as labels', () => {
      const values = [
        {
          type: 'data-channel',
          ordered: true,
          protocol: 'SCTP',
          messagesReceived: 10
        }
      ]

      const result = StatsFormatter.formatStats({
        url: 'https://example.com',
        state: 'connected',
        values
      })

      expect(result).toContain('ordered="true"')
      expect(result).toContain('protocol="SCTP"')
      expect(result).toContain('data_channel_messagesReceived{pageUrl="https://example.com",type="data-channel",ordered="true",protocol="SCTP"} 10')
    })
  })

  describe('getQualityLimitationValue', () => {
    test('should return correct numeric values for known reasons', () => {
      expect(StatsFormatter.getQualityLimitationValue('none')).toBe(0)
      expect(StatsFormatter.getQualityLimitationValue('bandwidth')).toBe(1)
      expect(StatsFormatter.getQualityLimitationValue('cpu')).toBe(2)
      expect(StatsFormatter.getQualityLimitationValue('other')).toBe(3)
    })

    test('should return undefined for unknown reasons', () => {
      expect(StatsFormatter.getQualityLimitationValue('unknown')).toBeUndefined()
      expect(StatsFormatter.getQualityLimitationValue('')).toBeUndefined()
      expect(StatsFormatter.getQualityLimitationValue(null)).toBeUndefined()
    })
  })

  describe('validateStats', () => {
    test('should validate correct stats array', () => {
      const values = [
        { type: 'inbound-rtp', packetsReceived: 100 },
        { type: 'outbound-rtp', packetsSent: 50 }
      ]

      const result = StatsFormatter.validateStats(values)
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    test('should reject non-array values', () => {
      const result = StatsFormatter.validateStats('not an array')
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Values must be an array')
    })

    test('should reject objects without type property', () => {
      const values = [
        { type: 'inbound-rtp', packetsReceived: 100 },
        { packetsReceived: 50 }, // Missing type
        { type: null, packetsSent: 25 } // Invalid type
      ]

      const result = StatsFormatter.validateStats(values)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Value at index 1 must have a string \'type\' property')
      expect(result.errors).toContain('Value at index 2 must have a string \'type\' property')
    })

    test('should reject non-object values in array', () => {
      const values = [
        { type: 'inbound-rtp', packetsReceived: 100 },
        'invalid',
        null
      ]

      const result = StatsFormatter.validateStats(values)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Value at index 1 must be an object')
      expect(result.errors).toContain('Value at index 2 must be an object')
    })
  })

  describe('normalizeMetricName', () => {
    test('should replace hyphens with underscores', () => {
      expect(StatsFormatter.normalizeMetricName('inbound-rtp')).toBe('inbound_rtp')
      expect(StatsFormatter.normalizeMetricName('remote-inbound-rtp')).toBe('remote_inbound_rtp')
    })

    test('should convert to lowercase', () => {
      expect(StatsFormatter.normalizeMetricName('INBOUND-RTP')).toBe('inbound_rtp')
      expect(StatsFormatter.normalizeMetricName('CamelCase-Name')).toBe('camelcase_name')
    })

    test('should handle non-string input', () => {
      expect(StatsFormatter.normalizeMetricName(null)).toBe('unknown')
      expect(StatsFormatter.normalizeMetricName(undefined)).toBe('unknown')
      expect(StatsFormatter.normalizeMetricName(123)).toBe('unknown')
    })
  })

  describe('escapeLabelValue', () => {
    test('should escape backslashes and quotes', () => {
      expect(StatsFormatter.escapeLabelValue('test\\value')).toBe('test\\\\value')
      expect(StatsFormatter.escapeLabelValue('test"value')).toBe('test\\"value')
      expect(StatsFormatter.escapeLabelValue('test\\and"quotes')).toBe('test\\\\and\\"quotes')
    })

    test('should escape newlines', () => {
      expect(StatsFormatter.escapeLabelValue('line1\nline2')).toBe('line1\\nline2')
    })

    test('should convert non-strings to strings', () => {
      expect(StatsFormatter.escapeLabelValue(123)).toBe('123')
      expect(StatsFormatter.escapeLabelValue(true)).toBe('true')
      expect(StatsFormatter.escapeLabelValue(null)).toBe('null')
    })
  })

  describe('getSupportedStatsTypes', () => {
    test('should return array of supported stats types', () => {
      const types = StatsFormatter.getSupportedStatsTypes()
      expect(Array.isArray(types)).toBe(true)
      expect(types).toContain('inbound-rtp')
      expect(types).toContain('outbound-rtp')
      expect(types).toContain('peer-connection')
      expect(types.length).toBeGreaterThan(5)
    })
  })

  describe('integration tests', () => {
    test('should format complex multi-type stats correctly', () => {
      const values = [
        {
          type: 'inbound-rtp',
          ssrc: 123456,
          packetsReceived: 1000,
          bytesReceived: 50000,
          mediaType: 'audio',
          jitter: 0.005
        },
        {
          type: 'outbound-rtp',
          ssrc: 654321,
          packetsSent: 800,
          bytesSent: 40000,
          mediaType: 'video',
          qualityLimitationReason: 'bandwidth'
        },
        {
          type: 'candidate-pair',
          state: 'succeeded',
          priority: 9115038255631187967,
          currentRoundTripTime: 0.1
        }
      ]

      const result = StatsFormatter.formatStats({
        url: 'https://teams.microsoft.com/meeting',
        state: 'connected',
        values,
        agentId: 'agent-test-123'
      })

      // Verify structure
      expect(result).toContain('# TYPE inbound_rtp_ssrc gauge')
      expect(result).toContain('# TYPE outbound_rtp_packetsSent gauge')
      expect(result).toContain('# TYPE candidate_pair_priority gauge')

      // Verify labels are included
      expect(result).toContain('pageUrl="https://teams.microsoft.com/meeting"')
      expect(result).toContain('agent_id="agent-test-123"')
      expect(result).toContain('mediaType="audio"')
      expect(result).toContain('mediaType="video"')

      // Verify quality limitation conversion
      expect(result).toContain('outbound_rtp_qualityLimitationReason{pageUrl="https://teams.microsoft.com/meeting",agent_id="agent-test-123",type="outbound-rtp",mediaType="video"} 1')

      // Verify metrics
      expect(result).toContain('inbound_rtp_packetsReceived{pageUrl="https://teams.microsoft.com/meeting",agent_id="agent-test-123",type="inbound-rtp",mediaType="audio"} 1000')
      expect(result).toContain('candidate_pair_currentRoundTripTime{pageUrl="https://teams.microsoft.com/meeting",agent_id="agent-test-123",type="candidate-pair",state="succeeded"} 0.1')
    })
  })
})