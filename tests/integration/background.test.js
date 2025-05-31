/**
 * Integration tests for background.js
 * Tests the main extension background functionality
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

describe('Background Script Integration', () => {
  beforeEach(() => {
    // Reset all mocks and globals
    jest.clearAllMocks();
    
    // Clear any existing global objects
    delete global.WebRTCExporterConfig;
    delete global.WebRTCExporterDomains;
    delete global.WebRTCExporterStorage;
    
    // Mock pako globally
    global.pako = {
      gzip: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3, 4]))
    };
    
    // Mock default Chrome API responses
    mockStorage({
      url: 'http://localhost:9091',
      username: '',
      password: '',
      updateInterval: 2,
      job: 'webrtc-internals-exporter',
      agentId: 'test-agent',
      enabledOrigins: {},
      enabledStats: ['inbound-rtp', 'outbound-rtp']
    });
    
    chrome.tabs.query.mockResolvedValue([createMockTab()]);
    chrome.tabs.get.mockResolvedValue(createMockTab());
    
    // Mock fetch for Pushgateway
    fetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(''),
      status: 200
    });
  });

  const loadBackgroundScript = () => {
    // Load shared modules first
    loadSharedModules();
    
    // Load background script
    const fs = require('fs');
    const path = require('path');
    const backgroundPath = path.join(__dirname, '..', '..', 'background.js');
    const backgroundCode = fs.readFileSync(backgroundPath, 'utf8');
    
    // Execute the background script code
    eval(backgroundCode);
  };

  describe('Extension Lifecycle', () => {
    test('should handle installation correctly', async () => {
      loadBackgroundScript();
      
      // Simulate extension installation
      const installListener = chrome.runtime.onInstalled.addListener.mock.calls[0][0];
      await installListener({ reason: 'install' });
      
      // Should set default options
      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://localhost:9091',
          job: 'webrtc-internals-exporter'
        })
      );
      
      // Should create alarm
      expect(chrome.alarms.create).toHaveBeenCalledWith(
        expect.stringContaining('webrtc-internals-exporter'),
        expect.objectContaining({
          delayInMinutes: expect.any(Number),
          periodInMinutes: expect.any(Number)
        })
      );
    });

    test('should handle updates correctly', async () => {
      const existingOptions = { url: 'http://custom.com', agentId: 'existing-agent' };
      mockStorage(existingOptions);
      
      loadBackgroundScript();
      
      // Simulate extension update
      const installListener = chrome.runtime.onInstalled.addListener.mock.calls[0][0];
      await installListener({ reason: 'update' });
      
      // Should merge existing options with defaults
      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          ...existingOptions,
          // Should include new defaults
          job: 'webrtc-internals-exporter'
        })
      );
    });
  });

  describe('Tab Monitoring', () => {
    test('should update badge for supported domains', async () => {
      const supportedTab = createMockTab({ 
        url: 'https://meet.google.com/test-meeting',
        id: 123
      });
      
      loadBackgroundScript();
      
      // Simulate tab activation
      const activationListener = chrome.tabs.onActivated.addListener.mock.calls[0][0];
      chrome.tabs.get.mockResolvedValue(supportedTab);
      
      await activationListener({ tabId: 123 });
      
      // Should set badge and title for supported domain
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 123 })
      );
      expect(chrome.action.setTitle).toHaveBeenCalledWith(
        expect.objectContaining({ 
          tabId: 123,
          title: expect.stringContaining('WebRTC Internals Exporter')
        })
      );
    });

    test('should handle unsupported domains', async () => {
      const unsupportedTab = createMockTab({ 
        url: 'https://example.com/page',
        id: 456
      });
      
      loadBackgroundScript();
      
      // Simulate tab activation
      const activationListener = chrome.tabs.onActivated.addListener.mock.calls[0][0];
      chrome.tabs.get.mockResolvedValue(unsupportedTab);
      
      await activationListener({ tabId: 456 });
      
      // Should clear badge for unsupported domain
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith(
        expect.objectContaining({ text: '', tabId: 456 })
      );
    });

    test('should handle tab update events', async () => {
      const updatedTab = createMockTab({ 
        url: 'https://teams.microsoft.com/meetings/join',
        id: 789
      });
      
      loadBackgroundScript();
      
      // Simulate tab update
      const updateListener = chrome.tabs.onUpdated.addListener.mock.calls[0][0];
      chrome.tabs.get.mockResolvedValue(updatedTab);
      
      await updateListener(789, { status: 'complete' }, updatedTab);
      
      // Should update badge for the new URL
      expect(chrome.action.setBadgeText).toHaveBeenCalled();
      expect(chrome.action.setTitle).toHaveBeenCalled();
    });
  });

  describe('WebRTC Stats Processing', () => {
    test('should process peer connection stats message', async () => {
      loadBackgroundScript();
      
      // Mock successful Pushgateway response
      fetch.mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue(''),
        status: 200
      });
      
      // Simulate receiving stats from content script
      const messageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const mockStats = [
        createMockWebRTCStats('inbound-rtp', {
          bytesReceived: 1000,
          packetsReceived: 10,
          packetsLost: 1
        })
      ];
      
      const response = await messageListener({
        event: 'peer-connection-stats',
        data: {
          url: 'https://meet.google.com/test-meeting',
          id: 'test-connection-id',
          state: 'connected',
          values: mockStats
        }
      });
      
      // Should send to Pushgateway
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/metrics/job/webrtc-internals-exporter'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8'
          }),
          body: expect.stringContaining('webrtc_')
        })
      );
      
      // Should return success
      expect(response).toEqual({ success: true });
    });

    test('should handle Pushgateway errors gracefully', async () => {
      loadBackgroundScript();
      
      // Mock Pushgateway failure
      fetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal Server Error')
      });
      
      const messageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const mockStats = [createMockWebRTCStats('outbound-rtp')];
      
      const response = await messageListener({
        event: 'peer-connection-stats',
        data: {
          url: 'https://meet.google.com/test-meeting',
          id: 'test-connection-id',
          state: 'connected',
          values: mockStats
        }
      });
      
      // Should return error
      expect(response).toEqual({ 
        error: expect.stringContaining('Failed to send metrics')
      });
    });

    test('should format metrics correctly', async () => {
      loadBackgroundScript();
      
      const messageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const mockStats = [
        createMockWebRTCStats('inbound-rtp', {
          id: 'RTCInboundRTPAudioStream_123',
          bytesReceived: 1500,
          packetsReceived: 15,
          packetsLost: 2,
          jitter: 0.005
        })
      ];
      
      await messageListener({
        event: 'peer-connection-stats',
        data: {
          url: 'https://meet.google.com/test-meeting',
          id: 'test-connection-id',
          state: 'connected',
          values: mockStats
        }
      });
      
      // Check that metrics are formatted correctly
      const fetchCall = fetch.mock.calls[0];
      const metricsBody = fetchCall[1].body;
      
      expect(metricsBody).toContain('webrtc_bytes_received');
      expect(metricsBody).toContain('webrtc_packets_received');
      expect(metricsBody).toContain('webrtc_packets_lost');
      expect(metricsBody).toContain('webrtc_jitter');
      
      // Should include agent_id label
      expect(metricsBody).toContain('agent_id="test-agent"');
      
      // Should include connection info
      expect(metricsBody).toContain('connection_id="test-connection-id"');
    });

    test('should handle gzip compression when enabled', async () => {
      // Enable gzip in storage
      mockStorage({
        url: 'http://localhost:9091',
        gzip: true,
        agentId: 'test-agent'
      });
      
      loadBackgroundScript();
      
      const messageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const mockStats = [createMockWebRTCStats('inbound-rtp')];
      
      await messageListener({
        event: 'peer-connection-stats',
        data: {
          url: 'https://meet.google.com/test-meeting',
          id: 'test-connection-id',
          state: 'connected',
          values: mockStats
        }
      });
      
      // Should use gzip
      expect(pako.gzip).toHaveBeenCalled();
      
      // Should set appropriate headers
      const fetchCall = fetch.mock.calls[0];
      expect(fetchCall[1].headers['Content-Encoding']).toBe('gzip');
    });
  });

  describe('Storage Integration', () => {
    test('should load options on startup', async () => {
      const customOptions = {
        url: 'http://custom-pushgateway.com:9091',
        agentId: 'custom-agent',
        updateInterval: 5
      };
      mockStorage(customOptions);
      
      loadBackgroundScript();
      
      // Wait for options to load
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Storage should have been queried
      expect(chrome.storage.sync.get).toHaveBeenCalled();
    });

    test('should respond to storage changes', async () => {
      loadBackgroundScript();
      
      // Get the storage change listener
      const storageListener = chrome.storage.onChanged.addListener.mock.calls[0][0];
      
      // Simulate storage change
      const changes = {
        url: { newValue: 'http://new-pushgateway.com:9091', oldValue: 'http://old.com' },
        agentId: { newValue: 'new-agent', oldValue: 'old-agent' }
      };
      
      storageListener(changes, 'sync');
      
      // Should update internal options and refresh tab info
      expect(chrome.tabs.query).toHaveBeenCalled();
    });
  });

  describe('Alarm Handling', () => {
    test('should handle cleanup alarms', async () => {
      loadBackgroundScript();
      
      // Mock some peer connection data
      chrome.storage.local.get.mockResolvedValue({
        peerConnectionsPerOrigin: {
          'https://meet.google.com': 2,
          'https://teams.microsoft.com': 1
        },
        peerConnectionsLastUpdate: {
          'https://meet.google.com': Date.now() - 10000, // 10 seconds ago
          'https://teams.microsoft.com': Date.now() - 300000 // 5 minutes ago (stale)
        }
      });
      
      // Simulate alarm
      const alarmListener = chrome.alarms.onAlarm.addListener.mock.calls[0][0];
      await alarmListener({ 
        name: global.WebRTCExporterConfig.CONSTANTS.EXTENSION.ALARM_NAME 
      });
      
      // Should clean up stale connections
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed stats messages', async () => {
      loadBackgroundScript();
      
      const messageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      
      // Send malformed message
      const response = await messageListener({
        event: 'peer-connection-stats',
        data: null // Invalid data
      });
      
      expect(response).toEqual({ 
        error: expect.stringContaining('Invalid') 
      });
    });

    test('should handle network failures gracefully', async () => {
      loadBackgroundScript();
      
      // Mock network failure
      fetch.mockRejectedValue(new Error('Network error'));
      
      const messageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const mockStats = [createMockWebRTCStats('inbound-rtp')];
      
      const response = await messageListener({
        event: 'peer-connection-stats',
        data: {
          url: 'https://meet.google.com/test-meeting',
          id: 'test-connection-id',
          state: 'connected',
          values: mockStats
        }
      });
      
      expect(response).toEqual({ 
        error: expect.stringContaining('Network error') 
      });
    });

    test('should handle Chrome API errors gracefully', async () => {
      // Mock Chrome API failure
      chrome.tabs.get.mockRejectedValue(new Error('Tab not found'));
      
      loadBackgroundScript();
      
      // Simulate tab activation
      const activationListener = chrome.tabs.onActivated.addListener.mock.calls[0][0];
      
      // Should not throw error
      await expect(activationListener({ tabId: 999 })).resolves.toBeUndefined();
    });
  });
});