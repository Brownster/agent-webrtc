class WebrtcInternalsExporter {
  peerConnections = new Map()

  url = ''
  enabled = false
  updateInterval = 2000
  enabledStats = []

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

  static log (...args) {
    // Always log RTCPeerConnection creation for debugging
    console.log.apply(null, ['[webrtc-internal-exporter:override]', ...args])
  }

  static randomId () {
    if ('randomUUID' in window.crypto) {
      return window.crypto.randomUUID()
    } else {
      return (2 ** 64 * Math.random()).toString(16)
    }
  }

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
        const event = new CustomEvent(
          'webrtc-internal-exporter:stats-from-page',
          { detail: payload }
        )
        window.dispatchEvent(event)
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
}

console.log('[webrtc-internal-exporter:override] Override script loaded, hooking RTCPeerConnection')
const webrtcInternalsExporter = new WebrtcInternalsExporter()

window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, {
  construct (target, argumentsList) {
    WebrtcInternalsExporter.log('RTCPeerConnection', argumentsList)

    const pc = new target(...argumentsList) // eslint-disable-line new-cap

    webrtcInternalsExporter.add(pc)

    return pc
  }
})
