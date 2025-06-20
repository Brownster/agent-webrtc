# Complete Call Lifecycle Walkthrough

This document traces the complete execution flow from web page loading through WebRTC call establishment to call termination, showing every function call and interaction.

## Phase 1: Web Page Loading & Extension Initialization

### 1.1 Page Load Begins
- User navigates to `teams.microsoft.com` or `meet.google.com`
- Chrome begins loading the page

### 1.2 Content Script Injection (Automatic)
```javascript
// Chrome automatically injects based on manifest.json:67-86
// content-script.js starts executing at document_start
```

**Function: Content Script Entry Point**
```javascript
// content-script.js:3-18
if (window.location.protocol.startsWith('http')) {
  const log = (...args) => {
    try {
      if (localStorage.getItem('webrtc-internal-exporter:debug') === 'true') {
        console.log.apply(null, [
          '[webrtc-internal-exporter:content-script]',
          ...args
        ])
      }
    } catch (error) {
      // Ignore localStorage errors.
    }
  }

  // Always log injection to verify it's working
  console.log('[webrtc-internal-exporter:content-script] Content script loaded on', window.location.origin)
```

### 1.3 Override Script Injection Setup
**Function: `injectScript()`**
```javascript
// content-script.js:20-40
const injectScript = (filePath) => {
  const script = document.createElement('script')
  script.setAttribute('type', 'text/javascript')
  script.setAttribute('src', filePath)

  // Safely append to head when available
  const head = document.querySelector('head')
  if (head) {
    head.appendChild(script)
  } else {
    // Wait for head to be available
    const observer = new MutationObserver(() => {
      const head = document.querySelector('head')
      if (head) {
        observer.disconnect()
        head.appendChild(script)
      }
    })
    observer.observe(document, { childList: true, subtree: true })
  }
}

// content-script.js:42 - Delayed injection
setTimeout(() => injectScript(chrome.runtime.getURL('override.js')))
```

### 1.4 Domain Manager Loading
**Function: `loadDomainManager()`**
```javascript
// content-script.js:60-97
const loadDomainManager = () => {
  const domainManagerScript = document.createElement('script')
  domainManagerScript.src = chrome.runtime.getURL('shared/domains.js')
  domainManagerScript.onload = () => {
    // Load options from storage
    chrome.storage.sync
      .get(['url', 'enabledOrigins', 'updateInterval', 'enabledStats'])
      .then((ret) => {
        log('options loaded:', ret)
        options.url = ret.url || ''
        // Use proper domain checking logic
        const DomainManager = window.WebRTCExporterDomains?.DomainManager
        if (DomainManager) {
          options.enabled = DomainManager.shouldAutoEnable(window.location.origin, ret.enabledOrigins || {})
        }
        options.updateInterval = (ret.updateInterval || 2) * 1000
        options.enabledStats = ret.enabledStats || ['inbound-rtp', 'remote-inbound-rtp', 'outbound-rtp']
        sendOptions()
      })
  }
  // Append script to head
}
```

## Phase 2: Override Script Execution & RTCPeerConnection Hooking

### 2.1 Override Script Loads
**Function: WebrtcInternalsExporter Constructor**
```javascript
// override.js:15-26
constructor () {
  window.addEventListener('message', async (message) => {
    const { event, options } = message.data
    if (event === 'webrtc-internal-exporter:options') {
      WebrtcInternalsExporter.log('Options received:', options)
      Object.assign(this, options)
    }
  })

  WebrtcInternalsExporter.log('WebrtcInternalsExporter initialized, posting ready event')
  window.postMessage({ event: 'webrtc-internal-exporter:ready' })
}
```

### 2.2 RTCPeerConnection Hijacking
**Function: RTCPeerConnection Property Override**
```javascript
// override.js:86-99
console.log('[webrtc-internal-exporter:override] Override script loaded, hooking RTCPeerConnection')

const OriginalRTCPeerConnection = window.RTCPeerConnection
if (!OriginalRTCPeerConnection) {
  console.error('[webrtc-internal-exporter:override] window.RTCPeerConnection is not available.')
  return
}

const webrtcInternalsExporter = new WebrtcInternalsExporter()

const RTCPeerConnectionProxy = function (...args) {
  WebrtcInternalsExporter.log('RTCPeerConnection', args)
  const pc = new OriginalRTCPeerConnection(...args)
  webrtcInternalsExporter.add(pc)
  return pc
}

Object.defineProperty(window, 'RTCPeerConnection', {
  get () {
    console.log('[webrtc-internal-exporter:override] A script is GETTING window.RTCPeerConnection. Returning our proxy.')
    return RTCPeerConnectionProxy
  },
  set () {
    console.warn('[webrtc-internal-exporter:override] A script is trying to SET window.RTCPeerConnection. We are ignoring it.')
  },
  enumerable: true,
  configurable: true
})
```

### 2.3 Options Exchange
**Function: Content Script Message Handler**
```javascript
// content-script.js:164-196
window.addEventListener('message', (message) => {
  const { event, url, id, state, values } = message.data
  if (event === 'webrtc-internal-exporter:ready') {
    console.log('[webrtc-internal-exporter:content-script] Override script ready, sending options')
    sendOptions()
  }
})

// content-script.js:52-57
const sendOptions = () => {
  window.postMessage({
    event: 'webrtc-internal-exporter:options',
    options
  })
}
```

## Phase 3: WebRTC Call Initiation

### 3.1 Application Creates RTCPeerConnection
When Teams/Meet/etc creates a peer connection:
```javascript
// Application code (e.g., Teams)
const pc = new RTCPeerConnection(config)  // This hits our proxy!
```

### 3.2 Proxy Intercepts Creation
**Function: RTCPeerConnectionProxy**
```javascript
// override.js:90-98
const RTCPeerConnectionProxy = function (...args) {
  WebrtcInternalsExporter.log('RTCPeerConnection', args)
  const pc = new OriginalRTCPeerConnection(...args) // Create real peer connection
  webrtcInternalsExporter.add(pc)  // Register with our tracker
  return pc
}
```

### 3.3 Peer Connection Registration
**Function: `webrtcInternalsExporter.add()`**
```javascript
// override.js:41-52
add (pc) {
  const id = WebrtcInternalsExporter.randomId()
  WebrtcInternalsExporter.log(`Adding RTCPeerConnection with ID: ${id}, enabled: ${this.enabled}, url: ${this.url}`)
  this.peerConnections.set(id, pc)
  
  // Listen for connection state changes
  pc.addEventListener('connectionstatechange', () => {
    WebrtcInternalsExporter.log(`Connection state changed for ${id}: ${pc.connectionState}`)
    if (pc.connectionState === 'closed') {
      this.peerConnections.delete(id)
    }
  })
  
  this.collectStats(id)  // Start collecting stats immediately
}
```

### 3.4 First Stats Collection
**Function: `collectStats()`**
```javascript
// override.js:48-83
async collectStats (id) {
  const pc = this.peerConnections.get(id)
  if (!pc) return

  WebrtcInternalsExporter.log(`collectStats for ${id}: enabled=${this.enabled}, url=${this.url}`)

  if (this.url && this.enabled) {
    try {
      const stats = await pc.getStats()  // Native WebRTC API call
      const allStats = [...stats.values()]
      const values = allStats.filter(
        (v) => ['peer-connection', ...this.enabledStats].indexOf(v.type) !== -1
      )
      
      // Dispatch stats to content script
      const payload = {
        url: window.location.href,
        id,
        state: pc.connectionState,
        values
      }
      window.postMessage(
        {
          event: 'webrtc-internal-exporter:peer-connection-stats',
          url: window.location.href,
          id,
          state: pc.connectionState,
          values
        },
        [values]
      )
    } catch (error) {
      WebrtcInternalsExporter.log(`collectStats error: ${error.message}`)
    }
  }

  // Schedule next collection (recursive)
  if (pc.connectionState !== 'closed') {
    setTimeout(this.collectStats.bind(this), this.updateInterval, id)
  }
}
```

## Phase 4: Stats Processing Pipeline

### 4.1 Content Script Receives Stats
**Function: Stats Event Listener**
```javascript
// content-script.js:140-161
window.addEventListener('webrtc-internal-exporter:stats-from-page', (event) => {
  const { url, id, state, values } = event.detail || {}
  console.log('[webrtc-internal-exporter:content-script] Caught stats from page, relaying to background.')
  
  try {
    chrome.runtime
      .sendMessage({
        event: 'peer-connection-stats',
        data: { url, id, state, values }
      })
      .then(() => {
        console.log('[webrtc-internal-exporter:content-script] Fired off stats to background.')
      })
      .catch((error) => {
        console.error('[webrtc-internal-exporter:content-script] Error sending stats to background:', error.message)
      })
  } catch (error) {
    console.error('[webrtc-internal-exporter:content-script] Failed to send message, context was likely invalidated:', error)
  }
}, false)
```

### 4.2 Background Script Message Handler
**Function: Background Message Handler**
```javascript
// background.js:87-93 - Message handler setup
return self.WebRTCExporterMessageHandler.createAndInitializeMessageHandler({
  statsFormatter: self.WebRTCExporterStatsFormatter.StatsFormatter,
  connectionSender: sendData,
  logger
}, options)
```

**Function: `handlePeerConnectionStats()`**
```javascript
// message-handler.js:121-153
async handlePeerConnectionStats ({ url, id, state, values }) {
  try {
    this.logger?.log(`Processing peer connection stats: ${id} (${state})`)

    const origin = new URL(url).origin

    if (state === 'closed') {
      // Handle connection closure
      await this.connectionSender('DELETE', { id, origin })
      return { success: true, action: 'deleted' }
    }

    // Format stats using the stats formatter
    const data = this.statsFormatter.formatStats({
      url,
      state,
      values,
      agentId: this.options.agentId
    })

    if (data.length > 0) {
      // Send formatted data
      await this.connectionSender('POST', { id, origin }, data + '\n')
      return { success: true, action: 'sent', dataLength: data.length }
    } else {
      this.logger?.log(`No data to send for connection ${id}`)
      return { success: true, action: 'skipped', reason: 'no-data' }
    }
  } catch (error) {
    this.logger?.log(`Error handling peer connection stats: ${error.message}`)
    throw new MessageHandlerError(`Failed to process peer connection stats: ${error.message}`)
  }
}
```

### 4.3 Stats Formatting
**Function: `StatsFormatter.formatStats()`**
```javascript
// stats-formatter.js:19-85
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

    // Process all numeric properties as metrics
    Object.entries(value).forEach(([key, v]) => {
      if (typeof v === 'number') {
        metrics.push([key, v])
      } else if (typeof v === 'string' || typeof v === 'boolean') {
        labels.push(`${key}="${v}"`)
      }
    })

    // Generate Prometheus format output
    metrics.forEach(([key, v]) => {
      const name = `${type}_${key.replace(/-/g, '_')}`
      
      if (!sentTypes.has(name)) {
        data += `# TYPE ${name} gauge\n`
        sentTypes.add(name)
      }
      
      data += `${name}{${labels.join(',')}} ${v}\n`
    })
  })

  return data
}
```

### 4.4 HTTP Request to Pushgateway
**Function: `sendData()` (Background)**
```javascript
// background.js:120-153
async function sendData (method, { id, origin }, data) {
  const { url, username, password, gzip, job } = options

  try {
    const result = await pushgatewayClient.sendData({
      method,
      url,
      job,
      id,
      username,
      password,
      gzip,
      data,
      statsCallback
    })

    // Update peer connection tracking on successful requests
    await connectionTracker.setPeerConnectionLastUpdate(
      { id, origin },
      method === 'POST' ? Date.now() : 0
    )

    return result
  } catch (error) {
    log(`sendData error for ${method} ${id}: ${error.message}`)
    throw error
  }
}
```

**Function: `pushgatewayClient.sendData()`**
```javascript
// pushgateway-client.js:83-150
async _sendDataDirect ({
  method, url, job, id, username, password, gzip = false, data, statsCallback
}) {
  this.requestCount++
  const start = Date.now()

  try {
    // Build request URL: /metrics/job/{job}/peerConnectionId/{id}
    const requestUrl = this._buildUrl(url, job, id)
    
    // Prepare headers (with auth if configured)
    const headers = this._buildHeaders({ username, password, gzip, data })
    
    // Compress data if needed
    const requestBody = await this._prepareBody(method, data, gzip)
    
    // Make HTTP request
    const response = await this._makeRequest(requestUrl, method, headers, requestBody)
    
    if (!response.ok) {
      throw new PushgatewayError(`Request failed: ${response.status}`)
    }
    
    return await response.text()
  } catch (error) {
    throw error
  }
}
```

## Phase 5: Ongoing Call Monitoring

### 5.1 Periodic Stats Collection
Every 2 seconds (default), the following cycle repeats:

1. **Timer Fires**: `setTimeout()` from previous `collectStats()` call
2. **Stats Collection**: `pc.getStats()` called on active peer connections
3. **Filtering**: Stats filtered by configured types
4. **Event Dispatch**: Custom event fired with stats data
5. **Content Script Relay**: Message sent to background script
6. **Background Processing**: Stats formatted and sent to Pushgateway
7. **Next Timer**: New `setTimeout()` scheduled for next collection

### 5.2 Connection State Monitoring
**Function: Connection State Change Handler**
```javascript
// override.js:45-50 (within add() method)
pc.addEventListener('connectionstatechange', () => {
  WebrtcInternalsExporter.log(`Connection state changed for ${id}: ${pc.connectionState}`)
  if (pc.connectionState === 'closed') {
    this.peerConnections.delete(id)
  }
})
```

## Phase 6: Call Termination

### 6.1 Connection State Changes to 'closed'
When the WebRTC call ends:

1. **Native Event**: RTCPeerConnection fires `connectionstatechange` event
2. **State Handler**: Our event listener detects `state === 'closed'`
3. **Local Cleanup**: Connection removed from `peerConnections` Map
4. **Final Stats**: Last stats collection with `state: 'closed'`

### 6.2 Background Handles Closed Connection
**Function: Closed Connection Processing**
```javascript
// message-handler.js:127-131
if (state === 'closed') {
  // Handle connection closure
  await this.connectionSender('DELETE', { id, origin })
  return { success: true, action: 'deleted' }
}
```

### 6.3 DELETE Request to Pushgateway
**Function: Delete Metrics**
```javascript
// pushgateway-client.js:166-168
async deleteMetrics (params) {
  return this.sendData({ ...params, method: 'DELETE', data: undefined })
}
```

### 6.4 Final Cleanup
1. **Connection Tracking**: Connection marked as inactive in background
2. **Timer Cleanup**: No more `setTimeout()` calls scheduled
3. **Memory Cleanup**: Peer connection reference removed from Map
4. **Pushgateway Cleanup**: DELETE request removes metrics from Pushgateway

## Summary: Complete Function Call Chain

**Page Load → Call Start:**
1. Chrome injects `content-script.js`
2. `injectScript()` → `loadDomainManager()` → `sendOptions()`
3. Override script loads → `WebrtcInternalsExporter()` constructor
4. `Object.defineProperty()` hijacks `RTCPeerConnection`
5. App creates connection → `RTCPeerConnectionProxy()` → `add()` → `collectStats()`

**During Call (every 2 seconds):**
1. `collectStats()` → `pc.getStats()` → `window.postMessage()`
2. Content script event listener → `chrome.runtime.sendMessage()`
3. `handlePeerConnectionStats()` → `formatStats()` → `sendData()`
4. `pushgatewayClient.sendData()` → HTTP POST to Pushgateway

**Call End:**
1. `connectionstatechange` event → state = 'closed'
2. Final `collectStats()` with closed state
3. `handlePeerConnectionStats()` → DELETE request
4. Connection cleanup and timer cancellation

This creates a complete monitoring lifecycle from page load to call completion, capturing all WebRTC statistics throughout the call duration.