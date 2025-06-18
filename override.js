// override.js - Final Cooperative Override
(function () {
  'use strict'
  console.log('[webrtc-exporter:override] Unified override script running.')

  const NativeRTCPeerConnection = window.RTCPeerConnection
  if (!NativeRTCPeerConnection) {
    console.error('[webrtc-exporter] Native RTCPeerConnection not found!')
    return
  }

  class WebrtcInternalsExporter {
    peerConnections = new Map()
    url = ''
    enabled = false
    updateInterval = 2000
    enabledStats = []

    constructor () {
      window.addEventListener('message', async (message) => {
        if (message.data && message.data.type === 'webrtc-exporter-options') {
          console.log('[webrtc-exporter:override] Options received:', message.data.options)
          Object.assign(this, message.data.options)
        }
      })

      console.log('[webrtc-exporter:override] Exporter initialized, posting ready event')
      window.postMessage({ type: 'webrtc-exporter-ready' })
    }

    static log (...args) {
      console.log('[webrtc-exporter:override]', ...args)
    }

    static randomId () {
      if ('randomUUID' in window.crypto) {
        return window.crypto.randomUUID()
      } else {
        return (Date.now() + Math.random()).toString(36)
      }
    }

    add (pc) {
      const id = WebrtcInternalsExporter.randomId()
      WebrtcInternalsExporter.log(`Adding RTCPeerConnection with ID: ${id}`)
      this.peerConnections.set(id, pc)

      pc.addEventListener('connectionstatechange', () => {
        WebrtcInternalsExporter.log(`Connection state for ${id} changed to: ${pc.connectionState}`)
        if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
          this.collectStats(id)
          this.peerConnections.delete(id)
        }
      })

      this.collectStats(id)
    }

    async collectStats (id) {
      const pc = this.peerConnections.get(id)
      if (!pc) return

      if (this.url && this.enabled) {
        try {
          const stats = await pc.getStats()
          const allStats = [...stats.values()]
          const values = allStats.filter(v => ['peer-connection', ...this.enabledStats].includes(v.type))

          if (values.length > 0) {
            const payload = {
              url: window.location.href,
              id,
              state: pc.connectionState,
              values
            }
            const event = new CustomEvent('webrtcStatsToRelay', { detail: payload })
            window.dispatchEvent(event)
          }
        } catch (error) {
          WebrtcInternalsExporter.log(`Error in collectStats for ${id}: ${error.message}`)
          this.peerConnections.delete(id)
          return
        }
      }

      if (this.peerConnections.has(id)) {
        setTimeout(() => this.collectStats(id), this.updateInterval)
      }
    }
  }
  const webrtcInternalsExporter = new WebrtcInternalsExporter()

  // Store the original native implementation and keep track of any adapter-applied shim
  const OriginalRTCPeerConnection = NativeRTCPeerConnection
  let ActiveAdapterShim = OriginalRTCPeerConnection

  // Proxy implemented as a normal function so its prototype remains writable
  const RTCPeerConnectionProxy = function (...args) {
    console.log('[webrtc-exporter] PROXY CONSTRUCTOR CALLED. Using the latest shim/original.')
    const pc = new ActiveAdapterShim(...args)
    webrtcInternalsExporter.add(pc)
    return pc
  }

  // Align proxy prototype with the underlying implementation
  Object.setPrototypeOf(RTCPeerConnectionProxy.prototype, OriginalRTCPeerConnection.prototype)
  RTCPeerConnectionProxy.prototype.constructor = RTCPeerConnectionProxy

  Object.defineProperty(window, 'RTCPeerConnection', {
    get: function () {
      console.log('[webrtc-exporter] GET intercepted. Returning our proxy function.')
      return RTCPeerConnectionProxy
    },
    set: function (newValue) {
      console.log('[webrtc-exporter] SET intercepted. A script (likely webrtc-adapter) is applying a shim. We will allow it and use it.')
      ActiveAdapterShim = newValue
      Object.setPrototypeOf(RTCPeerConnectionProxy.prototype, newValue.prototype)
      RTCPeerConnectionProxy.prototype.constructor = RTCPeerConnectionProxy
    },
    configurable: true
  })

  console.log('[webrtc-exporter] Override complete. Awaiting calls.')
})()
