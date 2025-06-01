/* global chrome, pako */

// Import shared modules
importScripts('assets/pako.min.js')
importScripts('shared/config.js')
importScripts('shared/domains.js')
importScripts('shared/storage.js')

// Use direct references to avoid variable declarations that might conflict
// These reference the global objects set by the shared modules

function log (...args) {
  console.log.apply(null, [self.WebRTCExporterConfig.CONSTANTS.LOGGING.PREFIX + ':background]', ...args])
}

log('loaded')

const options = {}

// Handle install/update.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  log('onInstalled', reason)
  if (reason === 'install') {
    await chrome.storage.sync.set(self.WebRTCExporterConfig.DEFAULT_OPTIONS)
  } else if (reason === 'update') {
    const options = await chrome.storage.sync.get()
    await chrome.storage.sync.set({
      ...self.WebRTCExporterConfig.DEFAULT_OPTIONS,
      ...options
    })
  }

  await chrome.alarms.create(self.WebRTCExporterConfig.CONSTANTS.EXTENSION.ALARM_NAME, {
    delayInMinutes: self.WebRTCExporterConfig.CONSTANTS.UPDATE_INTERVALS.CLEANUP_INTERVAL_MINUTES,
    periodInMinutes: self.WebRTCExporterConfig.CONSTANTS.UPDATE_INTERVALS.CLEANUP_INTERVAL_MINUTES
  })
})

async function updateTabInfo (tab) {
  const tabId = tab.id
  const url = tab.url || tab.pendingUrl

  // Skip if no valid URL or it's a chrome:// page
  if (!url || !url.startsWith('http')) {
    chrome.action.setTitle({
      title: 'WebRTC Internals Exporter (no valid page)',
      tabId
    })
    chrome.action.setBadgeText({ text: '', tabId })
    return
  }

  const origin = self.WebRTCExporterDomains.DomainManager.extractOrigin(url)
  if (!origin) {
    log(`Invalid URL: ${url}`)
    return
  }

  const isTarget = self.WebRTCExporterDomains.DomainManager.isTargetDomain(url)
  const isEnabled = self.WebRTCExporterDomains.DomainManager.shouldAutoEnable(origin, options.enabledOrigins)

  if (isEnabled) {
    const data = await self.WebRTCExporterStorage.StorageManager.getLocal(self.WebRTCExporterConfig.CONSTANTS.STORAGE_KEYS.PEER_CONNECTIONS_PER_ORIGIN)
    const peerConnections = (data[self.WebRTCExporterConfig.CONSTANTS.STORAGE_KEYS.PEER_CONNECTIONS_PER_ORIGIN]?.[origin]) || 0

    chrome.action.setTitle({
      title: `WebRTC Internals Exporter\nActive Peer Connections: ${peerConnections}`,
      tabId
    })
    chrome.action.setBadgeText({ text: `${peerConnections}`, tabId })
    chrome.action.setBadgeBackgroundColor({ color: 'rgb(63, 81, 181)', tabId })
  } else {
    const reason = isTarget ? '(disabled)' : '(unsupported domain)'
    chrome.action.setTitle({
      title: `WebRTC Internals Exporter ${reason}`,
      tabId
    })
    chrome.action.setBadgeText({ text: '', tabId })
  }
}

async function optionsUpdated () {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  })
  await updateTabInfo(tab)
}

// Load options using StorageManager
self.WebRTCExporterStorage.StorageManager.getOptions().then((loadedOptions) => {
  Object.assign(options, loadedOptions)
  log('options loaded')
  optionsUpdated()
}).catch((error) => {
  log('Error loading options:', error)
  Object.assign(options, self.WebRTCExporterConfig.DEFAULT_OPTIONS)
})

// Listen for options changes
self.WebRTCExporterStorage.StorageManager.onChanged((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) {
    options[key] = newValue
  }
  log('options changed')
  optionsUpdated()
})

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId)
    await updateTabInfo(tab)
  } catch (err) {
    log(`get tab error: ${err.message}`)
  }
})

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return
  try {
    const tab = await chrome.tabs.get(tabId)
    await updateTabInfo(tab)
  } catch (err) {
    log(`tab updated error: ${err.message}`)
  }
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === self.WebRTCExporterConfig.CONSTANTS.EXTENSION.ALARM_NAME) {
    cleanupPeerConnections().catch((err) => {
      log(`cleanup peer connections error: ${err.message}`)
    })
  }
})

async function setPeerConnectionLastUpdate ({ id, origin }, lastUpdate = 0) {
  let { peerConnectionsLastUpdate } = await chrome.storage.local.get(
    'peerConnectionsLastUpdate'
  )
  if (!peerConnectionsLastUpdate) {
    peerConnectionsLastUpdate = {}
  }
  if (lastUpdate) {
    peerConnectionsLastUpdate[id] = { origin, lastUpdate }
  } else {
    delete peerConnectionsLastUpdate[id]
  }
  await chrome.storage.local.set({ peerConnectionsLastUpdate })

  const peerConnectionsPerOrigin = {}
  Object.values(peerConnectionsLastUpdate).forEach(({ origin: o }) => {
    if (!peerConnectionsPerOrigin[o]) {
      peerConnectionsPerOrigin[o] = 0
    }
    peerConnectionsPerOrigin[o]++
  })
  await chrome.storage.local.set({ peerConnectionsPerOrigin })
  await optionsUpdated()
}

async function cleanupPeerConnections () {
  const { peerConnectionsLastUpdate } = await chrome.storage.local.get(
    'peerConnectionsLastUpdate'
  )
  if (
    !peerConnectionsLastUpdate ||
    !Object.keys(peerConnectionsLastUpdate).length
  ) {
    return
  }

  log(
    `checking stale peer connections (${
      Object.keys(peerConnectionsLastUpdate).length
    } total)`
  )
  const now = Date.now()
  await Promise.allSettled(
    Object.entries(peerConnectionsLastUpdate)
      .map(([id, { origin, lastUpdate }]) => {
        if (
          now - lastUpdate >
          Math.max(2 * options.updateInterval, 30) * 1000
        ) {
          return { id, origin }
        }
      })
      .filter((ret) => !!ret?.id)
      .map(({ id, origin }) => {
        log(`removing stale peer connection metrics: ${id} ${origin}`)
        return sendData('DELETE', { id, origin })
      })
  )
}

// Send data to pushgateway.
async function sendData (method, { id, origin }, data) {
  const { url, username, password, gzip, job } = options
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded'
  }
  if (username && password) {
    headers.Authorization = 'Basic ' + btoa(`${username}:${password}`)
  }
  if (data && gzip) {
    headers['Content-Encoding'] = 'gzip'
    data = await pako.gzip(data)
  }
  /* console.log(
    `[webrtc-internals-exporter] sendData: ${data.length} bytes (gzip: ${gzip}) url: ${url} job: ${job}`,
  ); */
  const start = Date.now()
  const response = await fetch(
    `${url}/metrics/job/${job}/peerConnectionId/${id}`,
    {
      method,
      headers,
      body: method === 'POST' ? data : undefined
    }
  )

  const stats = await chrome.storage.local.get([
    'messagesSent',
    'bytesSent',
    'totalTime',
    'errors'
  ])
  if (data) {
    stats.messagesSent = (stats.messagesSent || 0) + 1
    stats.bytesSent = (stats.bytesSent || 0) + data.length
    stats.totalTime = (stats.totalTime || 0) + Date.now() - start
  }
  if (!response.ok) {
    stats.errors = (stats.errors || 0) + 1
  }
  await chrome.storage.local.set(stats)

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Response status: ${response.status} error: ${text}`)
  }

  await setPeerConnectionLastUpdate(
    { id, origin },
    method === 'POST' ? start : undefined
  )

  return response.text()
}

// Use quality limitation reasons from shared config

/**
 * sendPeerConnectionStats
 * @param {string} url
 * @param {string} id
 * @param {RTCPeerConnectionState} state
 * @param {any} values
 */
async function sendPeerConnectionStats (url, id, state, values) {
  const origin = new URL(url).origin

  if (state === 'closed') {
    return sendData('DELETE', { id, origin })
  }

  let data = ''
  const sentTypes = new Set()

  values.forEach((value) => {
    const type = value.type.replace(/-/g, '_')
    const labels = [`pageUrl="${url}"`]
    const metrics = []

    // Add agent_id label if configured
    if (options.agentId) {
      labels.push(`agent_id="${options.agentId}"`)
    }

    if (value.type === 'peer-connection') {
      labels.push(`state="${state}"`)
    }

    Object.entries(value).forEach(([key, v]) => {
      if (typeof v === 'number') {
        metrics.push([key, v])
      } else if (typeof v === 'object') {
        Object.entries(v).forEach(([subkey, subv]) => {
          if (typeof subv === 'number') {
            metrics.push([`${key}_${subkey}`, subv])
          }
        })
      } else if (
        key === 'qualityLimitationReason' &&
        self.WebRTCExporterConfig.CONSTANTS.QUALITY_LIMITATION_REASONS[v] !== undefined
      ) {
        metrics.push([key, self.WebRTCExporterConfig.CONSTANTS.QUALITY_LIMITATION_REASONS[v]])
      } else if (key === 'googTimingFrameInfo') {
        // TODO
      } else {
        labels.push(`${key}="${v}"`)
      }
    })

    metrics.forEach(([key, v]) => {
      const name = `${type}_${key.replace(/-/g, '_')}`
      let typeDesc = ''

      if (!sentTypes.has(name)) {
        typeDesc = `# TYPE ${name} gauge\n`
        sentTypes.add(name)
      }
      data += `${typeDesc}${name}{${labels.join(',')}} ${v}\n`
    })
  })

  if (data.length > 0) {
    return sendData('POST', { id, origin }, data + '\n')
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.event === 'peer-connection-stats') {
    const { url, id, state, values } = message.data

    sendPeerConnectionStats(url, id, state, values)
      .then(() => {
        sendResponse({})
      })
      .catch((err) => {
        sendResponse({ error: err.message })
      })
  } else {
    sendResponse({ error: 'unknown event' })
  }

  return true
})
