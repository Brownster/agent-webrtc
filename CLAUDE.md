# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome extension called "WebRTC Stats Exporter Pro" that monitors WebRTC voice and video quality in browser-based communication platforms and exports metrics to a Prometheus Pushgateway. The extension targets enterprise call center environments and supports Microsoft Teams, Google Meet, Amazon Connect CCP, and other web-based softphones.

## Development Commands

Since this is a Chrome extension project without a traditional build system:

- **Testing**: Load extension via `chrome://extensions` → "Load unpacked"
- **Debugging**: 
  - Content script: Use browser DevTools on target pages
  - Background worker: Click "Service worker" link in `chrome://extensions`
  - Options page: Right-click options page → "Inspect"
- **Packaging**: Use Chrome's extension packaging tools or `chrome.exe --pack-extension=<path>`

## Architecture

### Core Components

1. **manifest.json**: Defines extension permissions, background worker, and target domains
2. **background.js**: Service worker that manages settings, handles metric collection, and pushes to Pushgateway
3. **content.js**: Injected into target pages to hook RTCPeerConnection and collect WebRTC stats
4. **options.js/html**: Configuration UI for Pushgateway settings and authentication

### Data Flow

1. Background worker detects target pages (Teams, Meet, etc.) and injects content script
2. Content script hooks `RTCPeerConnection` constructor to monitor all peer connections
3. Content script periodically calls `getStats()` on active connections
4. Metrics are formatted and sent to background worker via `chrome.runtime.sendMessage`
5. Background worker formats metrics in Prometheus text format and POSTs to Pushgateway

### Key Design Patterns

- **Settings Caching**: Background worker caches settings from `chrome.storage.sync` to avoid repeated reads
- **Domain Targeting**: Uses `TARGET_DOMAINS_CONFIG` to inject only on supported platforms
- **Connection Monitoring**: Tracks peer connection lifecycle to start/stop metric collection
- **Error Handling**: Graceful degradation when Pushgateway is unreachable or authentication fails

### Metric Collection Strategy

- Hooks into RTCPeerConnection at creation time (not declaratively)
- Collects outbound/inbound audio stats, candidate pair info, and media source levels
- Uses unique PC identifiers to track multiple simultaneous connections
- Automatic cleanup when connections close or fail

### Authentication & Security

- Supports Basic Auth and mTLS for Pushgateway access
- Credentials stored in `chrome.storage.sync` (unencrypted)
- Instance IDs constructed from configurable prefix + agent ID + tab ID
- Host permissions restricted to specific communication platforms

## Configuration Notes

- `host_permissions` in manifest.json must be updated for new target domains
- Pushgateway URL, authentication, and collection interval configurable via options page
- Agent ID becomes the `agent_id` label in Prometheus metrics
- Instance prefix becomes part of the Pushgateway push URL path

## Development Considerations

- Extension uses Manifest V3 service worker (not persistent background page)
- Content script injection happens on tab navigation, not declaratively
- Settings changes trigger cache reload via `chrome.storage.onChanged`
- WebRTC stats collection handles multiple concurrent peer connections per tab
- Prometheus metric naming follows standard conventions with `webrtc_` prefix