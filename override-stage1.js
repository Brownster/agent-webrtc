console.log('[webrtc-exporter:override-stage1] Running...')

// Preserve original peer connection constructor
window.RTCPeerConnection_ORIGINAL = window.RTCPeerConnection

Object.defineProperty(window, 'RTCPeerConnection', {
  configurable: true,
  enumerable: true,
  get() {
    console.log('[webrtc-exporter:override-stage1] GET RTCPeerConnection')
    return window.RTCPeerConnection_PROXY || window.RTCPeerConnection_ORIGINAL
  },
  set(newValue) {
    console.log('[webrtc-exporter:override-stage1] SET RTCPeerConnection to shim')
    window.RTCPeerConnection_SHIM = newValue
  }
})
