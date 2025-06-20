# WebRTC Traffic Capture Process

## Overview

This extension captures WebRTC statistics from RTCPeerConnection objects in web applications and exports them to a Prometheus Pushgateway. The process involves intercepting WebRTC APIs at the JavaScript level, collecting stats periodically, formatting them for Prometheus, and pushing them to a monitoring endpoint.

## Architecture Components

### 1. Content Script (`content-script.js`)
- **Purpose**: Bridge between web page and extension
- **Execution Context**: Runs in the page's content context
- **Key Functions**:
  - Injects the override script into the page
  - Relays messages between page and background script
  - Manages extension options and configuration

### 2. Override Script (`override.js`)
- **Purpose**: Intercepts and monitors RTCPeerConnection objects
- **Execution Context**: Runs in the page's main world context
- **Key Functions**:
  - Hooks into `window.RTCPeerConnection` constructor
  - Periodically collects WebRTC statistics
  - Posts stats messages to content script

### 3. Background Script (`background.js`)
- **Purpose**: Processes stats and sends to Pushgateway
- **Execution Context**: Service worker context
- **Key Functions**:
  - Receives stats from content scripts
  - Formats stats for Prometheus
  - Manages HTTP requests to Pushgateway

## Step-by-Step Process

### Step 1: Extension Initialization

When the extension loads on a target domain:

```javascript
// content-script.js:42
setTimeout(() => injectScript(chrome.runtime.getURL('override.js')))
```

The content script injects the override script into the page after a short delay to ensure the DOM is ready.

### Step 2: RTCPeerConnection Interception

The override script wraps the native RTCPeerConnection constructor with a Proxy:

```javascript
// override.js:89-101
window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, {
  construct (target, argumentsList) {
    WebrtcInternalsExporter.log('RTCPeerConnection', argumentsList)
    const pc = new target(...argumentsList) // eslint-disable-line new-cap
    webrtcInternalsExporter.add(pc)
    return pc
  }
})
```

The Proxy's `construct` handler intercepts all `RTCPeerConnection` creation events and registers each connection with the exporter:

### Step 3: Peer Connection Registration

When a new RTCPeerConnection is created, it's registered with the exporter:

```javascript
// override.js:41-52
add (pc) {
  const id = WebrtcInternalsExporter.randomId()
  WebrtcInternalsExporter.log(`Adding RTCPeerConnection with ID: ${id}, enabled: ${this.enabled}, url: ${this.url}`)
  this.peerConnections.set(id, pc)
  pc.addEventListener('connectionstatechange', () => {
    WebrtcInternalsExporter.log(`Connection state changed for ${id}: ${pc.connectionState}`)
    if (pc.connectionState === 'closed') {
      this.peerConnections.delete(id)
    }
  })
  this.collectStats(id)
}
```

### Step 4: Statistics Collection

The extension periodically collects WebRTC statistics:

```javascript
// override.js:48-83
async collectStats (id) {
  const pc = this.peerConnections.get(id)
  if (!pc) return

  WebrtcInternalsExporter.log(`collectStats for ${id}: enabled=${this.enabled}, url=${this.url}, enabledStats=${JSON.stringify(this.enabledStats)}`)

  if (this.url && this.enabled) {
    try {
      const stats = await pc.getStats()
      const allStats = [...stats.values()]
      const values = allStats.filter(
        (v) =>
          ['peer-connection', ...this.enabledStats].indexOf(v.type) !== -1
      )
      WebrtcInternalsExporter.log(`Collected ${allStats.length} total stats, filtered to ${values.length} matching types`)
      WebrtcInternalsExporter.log('Dispatching stats to content script')
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

  if (pc.connectionState === 'closed') {
    this.peerConnections.delete(id)
  } else {
    setTimeout(this.collectStats.bind(this), this.updateInterval, id)
  }
}
```

### Step 5: Stats Relay to Background

The content script listens for stats events and relays them to the background script:

```javascript
// content-script.js:138-168
window.addEventListener('message', async (message) => {
  const { event, url, id, state, values } = message.data
  if (event === 'webrtc-internal-exporter:peer-connection-stats') {
    console.log('[webrtc-internal-exporter:content-script] Caught stats from page, relaying to background.')
    log('peer-connection-stats', { url, id, state, values })
    try {
      await chrome.runtime.sendMessage({
        event: 'peer-connection-stats',
        data: { url, id, state, values }
      })
      console.log('[webrtc-internal-exporter:content-script] Fired off stats to background.')
    } catch (error) {
      console.error('[webrtc-internal-exporter:content-script] Error sending stats to background:', error.message)
      log(`error: ${error.message}`)
    }
  }
})
```

### Step 6: Background Processing

The background script receives and processes the stats through a message handler:

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

### Step 7: Stats Formatting

The stats formatter converts WebRTC stats to Prometheus text format:

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
```

### Step 8: HTTP Request to Pushgateway

The pushgateway client sends the formatted metrics:

```javascript
// pushgateway-client.js:38-150
async sendData ({
  method,
  url,
  job,
  id,
  username,
  password,
  gzip = false,
  data,
  statsCallback
}) {
  // ... validation and setup ...

  try {
    // Build request URL
    const requestUrl = this._buildUrl(url, job, id)
    
    // Prepare headers
    const headers = this._buildHeaders({ username, password, gzip, data })
    
    // Compress data if needed
    const requestBody = await this._prepareBody(method, data, gzip)
    
    // Make the request
    const response = await this._makeRequest(requestUrl, method, headers, requestBody)
    
    // Handle response
    if (!response.ok) {
      const errorText = await response.text()
      throw new PushgatewayError(
        `Pushgateway request failed: ${response.status} ${response.statusText}`,
        response.status,
        errorText
      )
    }

    return await response.text()
  } catch (error) {
    // Handle errors and statistics
    throw error
  }
}
```

## Data Flow Summary

1. **Content Script Injection**: Extension injects content script on target domains
2. **Override Script Injection**: Content script injects override script into page context
3. **RTCPeerConnection Interception**: Override script hooks into RTCPeerConnection constructor
4. **Stats Collection**: Periodically calls `getStats()` on tracked peer connections
5. **Event Dispatch**: Posts stats using window.postMessage
6. **Message Relay**: Content script relays stats to background script via Chrome messaging
7. **Stats Processing**: Background script formats stats to Prometheus format
8. **HTTP Request**: Sends formatted metrics to Pushgateway endpoint

## Key Features

### Filtering
- Only collects specified stat types (configurable via `enabledStats`)
- Filters out non-numeric values for metrics
- Converts string/boolean values to labels

### Authentication
- Supports Basic Authentication for Pushgateway
- Configurable username/password

### Compression
- Optional gzip compression for large payloads
- Uses pako.min.js library for compression

### Error Handling
- Network circuit breaker for reliability
- Retry logic with exponential backoff
- Comprehensive error logging

### Performance
- Configurable collection intervals
- Connection state tracking to avoid collecting from closed connections
- Automatic cleanup of closed connections

## Configuration

The extension can be configured via:
- Extension options page
- Chrome storage API
- Per-domain enable/disable settings
- Custom Pushgateway endpoints
- Authentication credentials
- Stats collection intervals
- Enabled stats types

This architecture ensures reliable, performant WebRTC statistics collection while maintaining isolation between different execution contexts and providing comprehensive monitoring capabilities.