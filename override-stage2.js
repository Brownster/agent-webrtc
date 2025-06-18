(function () {
  console.log('[webrtc-exporter:override-stage2] Running...')

  const FinalPeerConnection = window.RTCPeerConnection_SHIM || window.RTCPeerConnection_ORIGINAL
  if (!FinalPeerConnection) {
    console.error('[webrtc-exporter:override-stage2] No PeerConnection to wrap!')
    return
  }

  const webrtcInternalsExporter = new WebrtcInternalsExporter()

  class RTCPeerConnectionProxy extends FinalPeerConnection {
    constructor(...args) {
      console.log('!!!!!! [webrtc-exporter] new RTCPeerConnection() CONSTRUCTOR CALLED !!!!!!', args)
      super(...args)
      webrtcInternalsExporter.add(this)
    }
  }

  for (const staticMethod in FinalPeerConnection) {
    if (Object.prototype.hasOwnProperty.call(FinalPeerConnection, staticMethod)) {
      RTCPeerConnectionProxy[staticMethod] = FinalPeerConnection[staticMethod]
    }
  }

  window.RTCPeerConnection = RTCPeerConnectionProxy
  window.RTCPeerConnection_PROXY = RTCPeerConnectionProxy

  console.log('[webrtc-exporter:override-stage2] Final hook is in place.')

  // --- WebrtcInternalsExporter class ---
  class WebrtcInternalsExporter {
    peerConnections = new Map()

    url = ''
    enabled = false
    updateInterval = 2000
    enabledStats = []

    constructor () {
      window.addEventListener('message', async (message) => {
        if (message.data && message.data.type === 'webrtc-exporter-options') {
          console.log('[webrtc-exporter:override-stage2] Options received:', message.data.options)
          Object.assign(this, message.data.options)
        }
      })

      console.log('[webrtc-exporter:override-stage2] Exporter initialized, posting ready event')
      window.postMessage({ type: 'webrtc-exporter-ready' })
    }

    static log (...args) {
      console.log('[webrtc-exporter:override-stage2]', ...args)
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
})()
