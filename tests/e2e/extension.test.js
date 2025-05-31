/**
 * End-to-end tests for the complete extension workflow
 * Tests the integration between all components
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

describe('Extension E2E Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock a complete Chrome environment
    mockStorage({
      url: 'http://localhost:9091',
      username: '',
      password: '',
      updateInterval: 2,
      job: 'webrtc-internals-exporter',
      agentId: 'e2e-test-agent',
      enabledOrigins: {},
      enabledStats: ['inbound-rtp', 'outbound-rtp']
    });
    
    // Mock successful Pushgateway
    fetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(''),
      status: 200
    });
  });

  const loadAllComponents = () => {
    // Load shared modules
    loadSharedModules();
    
    // Load background script
    const fs = require('fs');
    const path = require('path');
    
    // Execute background script
    const backgroundPath = path.join(__dirname, '..', '..', 'background.js');
    const backgroundCode = fs.readFileSync(backgroundPath, 'utf8');
    eval(backgroundCode);
    
    return {
      WebRTCConfig: global.WebRTCExporterConfig,
      WebRTCDomains: global.WebRTCExporterDomains,
      WebRTCStorage: global.WebRTCExporterStorage
    };
  };

  describe('Complete WebRTC Stats Flow', () => {
    test('should handle full stats collection and export workflow', async () => {
      const { WebRTCDomains } = loadAllComponents();
      
      // 1. Simulate user navigating to Google Meet
      const meetTab = createMockTab({
        url: 'https://meet.google.com/abc-defg-hij',
        id: 1
      });
      
      chrome.tabs.get.mockResolvedValue(meetTab);
      
      // 2. Simulate tab activation (background script should update badge)
      const activationListener = chrome.tabs.onActivated.addListener.mock.calls[0][0];
      await activationListener({ tabId: 1 });
      
      // Badge should be updated for supported domain
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 1 })
      );
      expect(chrome.action.setTitle).toHaveBeenCalledWith(
        expect.objectContaining({ 
          tabId: 1,
          title: expect.stringContaining('WebRTC Internals Exporter')
        })
      );
      
      // 3. Verify domain is recognized as target
      expect(WebRTCDomains.DomainManager.isTargetDomain(meetTab.url)).toBe(true);
      expect(WebRTCDomains.DomainManager.shouldAutoEnable('https://meet.google.com', {})).toBe(true);
      
      // 4. Simulate WebRTC stats message from content script
      const messageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      
      const mockStats = [
        createMockWebRTCStats('inbound-rtp', {
          id: 'RTCInboundRTPAudioStream_incoming_audio',
          bytesReceived: 2500,
          packetsReceived: 25,
          packetsLost: 1,
          jitter: 0.003,
          kind: 'audio'
        }),
        createMockWebRTCStats('outbound-rtp', {
          id: 'RTCOutboundRTPAudioStream_outgoing_audio',
          bytesSent: 3000,
          packetsSent: 30,
          kind: 'audio'
        })
      ];
      
      const response = await messageListener({
        event: 'peer-connection-stats',
        data: {
          url: meetTab.url,
          id: 'peer-connection-12345',
          state: 'connected',
          values: mockStats
        }
      });
      
      // 5. Verify metrics were sent to Pushgateway
      expect(fetch).toHaveBeenCalledTimes(1);
      
      const fetchCall = fetch.mock.calls[0];
      const [url, options] = fetchCall;
      
      // Check URL format
      expect(url).toContain('/metrics/job/webrtc-internals-exporter');
      expect(url).toContain('instance=e2e-test-agent');
      
      // Check headers
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toContain('text/plain');
      
      // Check metrics content
      const metricsBody = options.body;
      expect(metricsBody).toContain('webrtc_bytes_received{');
      expect(metricsBody).toContain('webrtc_bytes_sent{');
      expect(metricsBody).toContain('agent_id="e2e-test-agent"');
      expect(metricsBody).toContain('connection_id="peer-connection-12345"');
      expect(metricsBody).toContain('origin="https://meet.google.com"');
      expect(metricsBody).toContain('platform="google-meet"');
      
      // 6. Verify successful response
      expect(response).toEqual({ success: true });
    });

    test('should handle disabled domain correctly', async () => {
      // Set domain as disabled in storage
      mockStorage({
        url: 'http://localhost:9091',
        agentId: 'test-agent',
        enabledOrigins: {
          'https://meet.google.com': false
        }
      });
      
      const { WebRTCDomains } = loadAllComponents();
      
      // Domain should not auto-enable when explicitly disabled
      expect(WebRTCDomains.DomainManager.shouldAutoEnable(
        'https://meet.google.com', 
        { 'https://meet.google.com': false }
      )).toBe(false);
      
      // Simulate tab navigation to disabled domain
      const meetTab = createMockTab({
        url: 'https://meet.google.com/disabled-meeting',
        id: 2
      });
      
      chrome.tabs.get.mockResolvedValue(meetTab);
      
      const activationListener = chrome.tabs.onActivated.addListener.mock.calls[0][0];
      await activationListener({ tabId: 2 });
      
      // Badge should show disabled status
      expect(chrome.action.setTitle).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: 2,
          title: expect.stringContaining('disabled')
        })
      );
    });

    test('should handle configuration changes dynamically', async () => {
      loadAllComponents();
      
      // Simulate configuration change
      const storageListener = chrome.storage.onChanged.addListener.mock.calls[0][0];
      
      const changes = {
        url: { 
          newValue: 'http://new-pushgateway.com:9091',
          oldValue: 'http://localhost:9091'
        },
        agentId: {
          newValue: 'updated-agent',
          oldValue: 'e2e-test-agent'
        }
      };
      
      storageListener(changes, 'sync');
      
      // Should refresh tab info after config change
      expect(chrome.tabs.query).toHaveBeenCalled();
      
      // Subsequent stats should use new configuration
      const messageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const mockStats = [createMockWebRTCStats('inbound-rtp')];
      
      await messageListener({
        event: 'peer-connection-stats',
        data: {
          url: 'https://meet.google.com/test',
          id: 'test-connection',
          state: 'connected',
          values: mockStats
        }
      });
      
      // Should use new Pushgateway URL
      const fetchCall = fetch.mock.calls[0];
      expect(fetchCall[0]).toContain('new-pushgateway.com:9091');
      
      // Should use new agent ID
      expect(fetchCall[1].body).toContain('agent_id="updated-agent"');
    });

    test('should handle multiple simultaneous connections', async () => {
      loadAllComponents();
      
      // Mock multiple peer connections in storage
      chrome.storage.local.get.mockResolvedValue({
        peerConnectionsPerOrigin: {
          'https://meet.google.com': 2,
          'https://teams.microsoft.com': 1
        }
      });
      
      const messageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      
      // Send stats for first connection
      await messageListener({
        event: 'peer-connection-stats',
        data: {
          url: 'https://meet.google.com/meeting1',
          id: 'connection-1',
          state: 'connected',
          values: [createMockWebRTCStats('inbound-rtp', { bytesReceived: 1000 })]
        }
      });
      
      // Send stats for second connection  
      await messageListener({
        event: 'peer-connection-stats',
        data: {
          url: 'https://meet.google.com/meeting2',
          id: 'connection-2',
          state: 'connected',
          values: [createMockWebRTCStats('outbound-rtp', { bytesSent: 2000 })]
        }
      });
      
      // Should send metrics for both connections
      expect(fetch).toHaveBeenCalledTimes(2);
      
      // First call should have connection-1 data
      expect(fetch.mock.calls[0][1].body).toContain('connection_id="connection-1"');
      expect(fetch.mock.calls[0][1].body).toContain('webrtc_bytes_received');
      
      // Second call should have connection-2 data
      expect(fetch.mock.calls[1][1].body).toContain('connection_id="connection-2"');
      expect(fetch.mock.calls[1][1].body).toContain('webrtc_bytes_sent');
    });

    test('should handle error recovery gracefully', async () => {
      loadAllComponents();
      
      // Mock Pushgateway failure
      fetch.mockRejectedValueOnce(new Error('Network timeout'));
      
      const messageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const mockStats = [createMockWebRTCStats('inbound-rtp')];
      
      // First attempt should fail
      const response1 = await messageListener({
        event: 'peer-connection-stats',
        data: {
          url: 'https://meet.google.com/test',
          id: 'test-connection',
          state: 'connected',
          values: mockStats
        }
      });
      
      expect(response1).toEqual({ 
        error: expect.stringContaining('Network timeout') 
      });
      
      // Mock recovery (Pushgateway back online)
      fetch.mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(''),
        status: 200
      });
      
      // Second attempt should succeed
      const response2 = await messageListener({
        event: 'peer-connection-stats',
        data: {
          url: 'https://meet.google.com/test',
          id: 'test-connection',
          state: 'connected',
          values: mockStats
        }
      });
      
      expect(response2).toEqual({ success: true });
    });
  });

  describe('Extension State Management', () => {
    test('should maintain consistent state across components', async () => {
      const { WebRTCConfig, WebRTCDomains, WebRTCStorage } = loadAllComponents();
      
      // Verify shared configuration consistency
      expect(WebRTCConfig.DEFAULT_OPTIONS.job).toBe('webrtc-internals-exporter');
      expect(WebRTCDomains.TARGET_DOMAINS).toContain('meet.google.com');
      expect(WebRTCDomains.TARGET_DOMAINS).toContain('teams.microsoft.com');
      
      // Test storage operations
      const testOptions = {
        url: 'http://test.com:9091',
        agentId: 'consistency-test'
      };
      
      chrome.storage.sync.set.mockResolvedValue();
      await WebRTCStorage.StorageManager.set(testOptions);
      
      // Should validate before storing
      expect(chrome.storage.sync.set).toHaveBeenCalledWith(testOptions);
      
      // Test domain validation consistency
      const validUrls = [
        'https://meet.google.com/test',
        'https://teams.microsoft.com/join',
        'https://app.mypurecloud.com/call'
      ];
      
      validUrls.forEach(url => {
        expect(WebRTCDomains.DomainManager.isTargetDomain(url)).toBe(true);
        expect(WebRTCDomains.DomainManager.validateUrl(url)).toBe(true);
      });
    });

    test('should handle cleanup operations correctly', async () => {
      loadAllComponents();
      
      // Mock stale connection data
      const staleData = {
        peerConnectionsPerOrigin: {
          'https://meet.google.com': 1,
          'https://old-meeting.com': 1
        },
        peerConnectionsLastUpdate: {
          'https://meet.google.com': Date.now() - 30000, // 30 seconds ago
          'https://old-meeting.com': Date.now() - 600000 // 10 minutes ago (stale)
        }
      };
      
      chrome.storage.local.get.mockResolvedValue(staleData);
      chrome.storage.local.set.mockResolvedValue();
      
      // Simulate cleanup alarm
      const alarmListener = chrome.alarms.onAlarm.addListener.mock.calls[0][0];
      await alarmListener({ 
        name: global.WebRTCExporterConfig.CONSTANTS.EXTENSION.ALARM_NAME 
      });
      
      // Should clean up stale connections
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          peerConnectionsPerOrigin: expect.objectContaining({
            'https://meet.google.com': 1
            // 'https://old-meeting.com' should be removed
          })
        })
      );
    });
  });
});