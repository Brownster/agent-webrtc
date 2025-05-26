# Auto WebRTC Capture Implementation Plan

This document outlines how to modify the existing `webrtc-internals-exporter` extension to automatically capture WebRTC stats based on domain detection, eliminating the need for manual enabling of each origin.

## Current Architecture Analysis

### Existing Flow
1. **Background Script** - Manages settings and handles stats messages
2. **Content Script** - Injects override script and manages options communication
3. **Override Script** - Hooks RTCPeerConnection and collects stats
4. **Manual Enabling** - User must manually enable each origin via popup/options

### Key Files
- `background.js` - Service worker handling stats push to Pushgateway
- `content-script.js` - Content script that injects override and manages settings
- `override.js` - Page-level script that hooks RTCPeerConnection
- `manifest.json` - Extension configuration
- `popup.html/popup.js` - UI for enabling/disabling origins

## Implementation Strategy

### Phase 1: Automatic Domain Detection

#### 1.1 Define Target Domains
Create a centralized configuration for target platforms:

```javascript
// In background.js
const TARGET_PLATFORMS = {
  'teams.microsoft.com': {
    app: 'microsoft_teams',
    paths: ['*'],
    autoEnable: true
  },
  'meet.google.com': {
    app: 'google_meet', 
    paths: ['*'],
    autoEnable: true
  },
  'awsapps.com': {
    app: 'amazon_connect_ccp',
    paths: ['/connect/ccp*'],
    autoEnable: true
  },
  'my.connect.aws': {
    app: 'amazon_connect_ccp',
    paths: ['/ccp-v2*'],
    autoEnable: true
  },
  'mypurecloud.com': {
    app: 'genesys_cloud',
    paths: ['*'],
    autoEnable: true
  },
  'genesys.com': {
    app: 'genesys_cloud',
    paths: ['*'],
    autoEnable: true
  },
  // Regional Genesys Cloud domains
  'mypurecloud.com.au': { app: 'genesys_cloud', paths: ['*'], autoEnable: true },
  'mypurecloud.ie': { app: 'genesys_cloud', paths: ['*'], autoEnable: true },
  'mypurecloud.de': { app: 'genesys_cloud', paths: ['*'], autoEnable: true },
  'mypurecloud.jp': { app: 'genesys_cloud', paths: ['*'], autoEnable: true },
  'usw2.pure.cloud': { app: 'genesys_cloud', paths: ['*'], autoEnable: true },
  'cac1.pure.cloud': { app: 'genesys_cloud', paths: ['*'], autoEnable: true },
  'euw1.pure.cloud': { app: 'genesys_cloud', paths: ['*'], autoEnable: true }
};
```

#### 1.2 Auto-Enable Function
Add domain detection and auto-enabling logic:

```javascript
// In background.js
function shouldAutoEnable(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const pathname = urlObj.pathname;
    
    for (const [domain, config] of Object.entries(TARGET_PLATFORMS)) {
      if (hostname.includes(domain) && config.autoEnable) {
        // Check path restrictions if any
        if (config.paths.includes('*')) {
          return { shouldEnable: true, app: config.app };
        }
        
        for (const path of config.paths) {
          const pathPattern = path.replace('*', '.*');
          if (new RegExp(pathPattern).test(pathname)) {
            return { shouldEnable: true, app: config.app };
          }
        }
      }
    }
    
    return { shouldEnable: false, app: null };
  } catch (error) {
    return { shouldEnable: false, app: null };
  }
}

async function autoEnableIfNeeded(origin) {
  const { shouldEnable, app } = shouldAutoEnable(origin);
  
  if (shouldEnable) {
    const { enabledOrigins = {} } = await chrome.storage.sync.get('enabledOrigins');
    
    if (!enabledOrigins[origin]) {
      enabledOrigins[origin] = true;
      await chrome.storage.sync.set({ enabledOrigins });
      log(`Auto-enabled origin: ${origin} (${app})`);
    }
    
    return app;
  }
  
  return null;
}
```

### Phase 2: Tab Management Integration

#### 2.1 Enhanced Tab Monitoring
Modify the existing tab monitoring to auto-enable:

```javascript
// Replace existing updateTabInfo function
async function updateTabInfo(tab) {
  const tabId = tab.id;
  let origin;
  
  try {
    origin = new URL(tab.url || tab.pendingUrl).origin;
  } catch (e) {
    return;
  }

  // Auto-enable if it's a target platform
  const app = await autoEnableIfNeeded(origin);
  
  if (app) {
    const { peerConnectionsPerOrigin } = await chrome.storage.local.get("peerConnectionsPerOrigin");
    const peerConnections = (peerConnectionsPerOrigin && peerConnectionsPerOrigin[origin]) || 0;

    chrome.action.setTitle({
      title: `WebRTC Internals Exporter (Auto)\\nApp: ${app}\\nActive: ${peerConnections}`,
      tabId,
    });
    chrome.action.setBadgeText({ text: `${peerConnections}`, tabId });
    chrome.action.setBadgeBackgroundColor({ color: "rgb(63, 81, 181)", tabId });
  } else {
    chrome.action.setTitle({
      title: `WebRTC Internals Exporter\\nNot a monitored platform`,
      tabId,
    });
    chrome.action.setBadgeText({ text: "", tabId });
  }
}
```

#### 2.2 Installation Auto-Setup
Auto-enable all target domains on install:

```javascript
// Add to chrome.runtime.onInstalled listener
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  log("onInstalled", reason);
  
  if (reason === "install") {
    await chrome.storage.sync.set(DEFAULT_OPTIONS);
    
    // Auto-enable all target domains
    const enabledOrigins = {};
    for (const domain of Object.keys(TARGET_PLATFORMS)) {
      enabledOrigins[`https://${domain}`] = true;
      enabledOrigins[`http://${domain}`] = true;
      // Handle subdomains
      enabledOrigins[`https://www.${domain}`] = true;
    }
    
    await chrome.storage.sync.set({ enabledOrigins });
    log("Auto-enabled target domains:", Object.keys(enabledOrigins));
    
  } else if (reason === "update") {
    const options = await chrome.storage.sync.get();
    await chrome.storage.sync.set({
      ...DEFAULT_OPTIONS,
      ...options,
    });
  }

  await chrome.alarms.create("webrtc-internals-exporter-alarm", {
    delayInMinutes: 1,
    periodInMinutes: 1,
  });
});
```

### Phase 3: Content Script Modifications

#### 3.1 Always-Enable Content Script
Modify `content-script.js` to always enable on target domains:

```javascript
// Replace the enabledOrigins check
chrome.storage.sync
  .get(["url", "updateInterval", "enabledStats"])
  .then((ret) => {
    log(`Options loaded:`, ret);
    options.url = ret.url || "";
    
    // Always enabled on target domains
    options.enabled = shouldAutoEnable(window.location.href).shouldEnable;
    
    options.updateInterval = (ret.updateInterval || 2) * 1000;
    options.enabledStats = Object.values(ret.enabledStats || {});
    sendOptions();
  });
```

#### 3.2 Dynamic Application Detection
Add application detection to stats messages:

```javascript
// In content-script.js message handler
window.addEventListener("message", async (message) => {
  const { event, url, id, state, values } = message.data;
  if (event === "webrtc-internal-exporter:ready") {
    sendOptions();
  } else if (event === "webrtc-internal-exporter:peer-connection-stats") {
    // Add application detection
    const { app } = shouldAutoEnable(url);
    
    log("peer-connection-stats", { url, id, state, values, app });
    try {
      const response = await chrome.runtime.sendMessage({
        event: "peer-connection-stats",
        data: {
          url,
          id,
          state,
          values,
          application: app || 'unknown' // Add app info
        },
      });
      if (response.error) {
        log(`error: ${response.error}`);
      }
    } catch (error) {
      log(`Error sending stats: ${error.message}`);
    }
  }
});
```

### Phase 4: Manifest Updates

#### 4.1 Content Scripts Declaration
Add content scripts to manifest for automatic injection:

```json
{
  "content_scripts": [
    {
      "matches": [
        "*://*.teams.microsoft.com/*",
        "*://meet.google.com/*",
        "*://*.awsapps.com/*",
        "*://*.my.connect.aws/*",
        "*://*.mypurecloud.com/*",
        "*://*.genesys.com/*",
        "*://*.mypurecloud.com.au/*",
        "*://*.mypurecloud.ie/*",
        "*://*.mypurecloud.de/*",
        "*://*.mypurecloud.jp/*",
        "*://*.usw2.pure.cloud/*",
        "*://*.cac1.pure.cloud/*",
        "*://*.euw1.pure.cloud/*"
      ],
      "js": ["content-script.js"],
      "run_at": "document_start"
    }
  ]
}
```

#### 4.2 Host Permissions
Ensure all target domains are covered:

```json
{
  "host_permissions": [
    "*://*.teams.microsoft.com/*",
    "*://meet.google.com/*",
    "*://*.awsapps.com/*",
    "*://*.my.connect.aws/*",
    "*://*.mypurecloud.com/*",
    "*://*.genesys.com/*",
    "*://*.mypurecloud.com.au/*",
    "*://*.mypurecloud.ie/*",
    "*://*.mypurecloud.de/*",
    "*://*.mypurecloud.jp/*",
    "*://*.usw2.pure.cloud/*",
    "*://*.cac1.pure.cloud/*",
    "*://*.euw1.pure.cloud/*"
  ]
}
```

### Phase 5: Enhanced Stats Processing

#### 5.1 Application-Aware Metrics
Modify background stats handling to include application labels:

```javascript
// In background.js handleStatsPush function
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.event === "peer-connection-stats") {
    try {
      const { url, id, state, values, application } = message.data;
      
      // Add application context to stats
      const enhancedData = {
        ...message.data,
        application: application || getApplicationFromUrl(url),
        timestamp: Date.now(),
        tabId: sender.tab?.id
      };
      
      await handleStatsPush(enhancedData, sender.tab);
      sendResponse({ success: true });
    } catch (error) {
      log("Error handling stats:", error);
      sendResponse({ error: error.message });
    }
  }
  return true;
});
```

#### 5.2 Prometheus Label Enhancement
Add application labels to Prometheus metrics:

```javascript
// In stats formatting
const baseLabels = {
  application: data.application,
  agent_id: options.agentId || 'unknown',
  peerConnectionId: data.id,
  instance: `${options.instancePrefix}_${options.agentId}_tab_${data.tabId}`
};
```

### Phase 6: UI Improvements

#### 6.1 Auto-Status Popup
Modify popup to show auto-enable status:

```javascript
// In popup.js
async function updatePopupStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab?.url) {
    const { shouldEnable, app } = shouldAutoEnable(tab.url);
    
    if (shouldEnable) {
      statusElement.textContent = `✅ Auto-monitoring: ${app}`;
      statusElement.className = 'status enabled';
    } else {
      statusElement.textContent = '❌ Not a monitored platform';
      statusElement.className = 'status disabled';
    }
  }
}
```

#### 6.2 Settings Indication
Update options page to show auto-enabled domains:

```html
<!-- In options.html -->
<div class="auto-domains">
  <h3>Auto-Monitored Platforms</h3>
  <p>The following platforms are automatically monitored:</p>
  <ul id="autoDomainsList">
    <!-- Populated by JavaScript -->
  </ul>
</div>
```

## Implementation Timeline

### Week 1: Core Auto-Detection
- [ ] Implement domain detection logic
- [ ] Add auto-enable functions
- [ ] Update background.js with TARGET_PLATFORMS
- [ ] Test basic auto-enabling functionality

### Week 2: Integration & Content Scripts
- [ ] Modify content-script.js for always-on mode
- [ ] Update manifest with content_scripts
- [ ] Add application detection to stats
- [ ] Test end-to-end stats collection

### Week 3: UI & Enhancement
- [ ] Update popup for auto-status display
- [ ] Enhance options page with auto-domain list
- [ ] Add application labels to Prometheus metrics
- [ ] Comprehensive testing across all platforms

### Week 4: Testing & Deployment
- [ ] Test on all target platforms
- [ ] Verify metric labeling and application detection
- [ ] Performance testing with multiple simultaneous sessions
- [ ] Documentation updates

## Testing Strategy

### Unit Testing
- Domain detection logic with various URL formats
- Auto-enable function with edge cases
- Application detection accuracy

### Integration Testing
- Full stats collection pipeline
- Prometheus metric formatting with application labels
- Multiple platform simultaneous monitoring

### Platform Testing
- Microsoft Teams (various meeting types)
- Google Meet (personal and enterprise)
- Amazon Connect CCP (different AWS regions)
- Genesys Cloud (all regional deployments)

## Risk Mitigation

### Performance Considerations
- Limit auto-enable checks to prevent excessive storage operations
- Cache domain detection results for repeated URL checks
- Optimize content script injection timing

### Compatibility Issues
- Maintain backward compatibility with manual enable/disable
- Handle edge cases where auto-detection fails
- Provide fallback mechanisms for unsupported platforms

### Security Concerns
- Validate all URL parsing to prevent injection attacks
- Ensure domain detection doesn't leak sensitive information
- Maintain principle of least privilege for permissions

## Success Metrics

- **Zero Manual Configuration**: Users shouldn't need to manually enable any target platform
- **100% Platform Coverage**: All defined target platforms automatically detected and enabled
- **Performance Baseline**: No more than 10ms overhead for domain detection per page load
- **Reliability**: 99.9% accurate application detection across all platforms
- **User Experience**: Immediate stats collection upon joining calls without any user interaction

## Future Enhancements

### Phase 2 Features
- Custom domain configuration via enterprise policies
- Machine learning-based platform detection for unknown domains
- Advanced filtering based on call types or meeting contexts
- Integration with enterprise directory services for agent identification

### Monitoring & Analytics
- Dashboard for deployment-wide statistics
- Alerting for failed auto-detections
- Performance metrics and optimization insights
- Usage analytics across different platforms