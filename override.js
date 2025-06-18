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

  function createProxy (target) {
    const RTCPeerConnectionProxy = class extends target {
      constructor (...args) {
        console.log('!!!!!! [webrtc-exporter] PROXY CONSTRUCTOR CALLED !!!!!!', args)
        super(...args)
        webrtcInternalsExporter.add(this)
      }
    }
    for (const staticMethod in target) {
      if (Object.prototype.hasOwnProperty.call(target, staticMethod)) {
        RTCPeerConnectionProxy[staticMethod] = target[staticMethod]
      }
    }
    return RTCPeerConnectionProxy
  }

  let currentPeerConnection = NativeRTCPeerConnection

  Object.defineProperty(window, 'RTCPeerConnection', {
    get: function () {
      console.log('[webrtc-exporter] GET intercepted. Returning our proxy.')
      return createProxy(currentPeerConnection)
    },
    set: function (newValue) {
      console.log('[webrtc-exporter] SET intercepted. A script (webrtc-adapter) is applying a shim. We will use it.')
      currentPeerConnection = newValue
    },
    enumerable: true,
    configurable: true
  })

  console.log('[webrtc-exporter] Override complete. Awaiting calls.')
})()
