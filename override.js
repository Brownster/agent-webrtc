// override.js -- Final Production Version

(function () {
  'use strict';
  console.log('[webrtc-exporter:override] Initializing...');

  // 1. Check if the original RTCPeerConnection exists.
  if (!window.RTCPeerConnection) {
    console.error('[webrtc-exporter:override] window.RTCPeerConnection not found. Cannot apply hooks.');
    return;
  }

  // 2. Store the original native function. This is our baseline.
  const NativeRTCPeerConnection = window.RTCPeerConnection;
  const webrtcInternalsExporter = new WebrtcInternalsExporter();

  // 3. Define our Proxy Class. It will EXTEND the native (or shimmed) RTCPeerConnection.
  //    This preserves the prototype chain and makes `instanceof` checks work.
  class RTCPeerConnectionProxy extends NativeRTCPeerConnection {
    constructor(...args) {
      console.log('!!!!!! [webrtc-exporter] new RTCPeerConnection() CONSTRUCTOR CALLED !!!!!!', args);

      // Call the parent constructor. This is critical.
      // It executes the native (or webrtc-adapter's) logic to create the real object.
      super(...args);
      
      // Now that the real object is created (`this`), we can add it to our tracker.
      webrtcInternalsExporter.add(this);
    }
  }

  // 4. Overwrite the window property with our proxy class.
  window.RTCPeerConnection = RTCPeerConnectionProxy;

  // 5. Copy any static methods from the original to our proxy.
  //    (e.g., RTCPeerConnection.generateCertificate)
  for (const staticMethod in NativeRTCPeerConnection) {
    if (Object.prototype.hasOwnProperty.call(NativeRTCPeerConnection, staticMethod)) {
      window.RTCPeerConnection[staticMethod] = NativeRTCPeerConnection[staticMethod];
    }
  }
  
  console.log('[webrtc-exporter:override] Hooking complete. Ready for calls.');

  // The WebrtcInternalsExporter class remains the same as in the last version.
  // Ensure it is included below this setup code.
  class WebrtcInternalsExporter {
    peerConnections = new Map()
 
    url = ''
    enabled = false
    updateInterval = 2000
    enabledStats = []
 
    constructor () {
      window.addEventListener('message', async (message) => {
        // Use a more specific event name to avoid conflicts
        if (message.data && message.data.type === 'webrtc-exporter-options') {
          console.log('[webrtc-exporter:override] Options received:', message.data.options);
          Object.assign(this, message.data.options)
        }
      })
 
      console.log('[webrtc-exporter:override] Exporter initialized, posting ready event');
      window.postMessage({ type: 'webrtc-exporter-ready' });
    }
 
    static log (...args) {
      console.log('[webrtc-exporter:override]', ...args);
    }
 
    static randomId () {
      if ('randomUUID' in window.crypto) {
        return window.crypto.randomUUID();
      } else {
        // Fallback for older contexts if needed
        return (Date.now() + Math.random()).toString(36);
      }
    }
 
    add (pc) {
      const id = WebrtcInternalsExporter.randomId();
      WebrtcInternalsExporter.log(`Adding RTCPeerConnection with ID: ${id}`);
      this.peerConnections.set(id, pc);

      pc.addEventListener('connectionstatechange', () => {
        WebrtcInternalsExporter.log(`Connection state for ${id} changed to: ${pc.connectionState}`);
        if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
          // Ensure we collect one last time on failure/closure
          this.collectStats(id);
          this.peerConnections.delete(id);
        }
      });

      // Start collecting stats
      this.collectStats(id);
    }
 
    async collectStats (id) {
      const pc = this.peerConnections.get(id);
      if (!pc) return;
 
      if (this.url && this.enabled) {
        try {
          const stats = await pc.getStats();
          const allStats = [...stats.values()];
          const values = allStats.filter(v => ['peer-connection', ...this.enabledStats].includes(v.type));
 
          if (values.length > 0) {
              const payload = {
                  url: window.location.href,
                  id,
                  state: pc.connectionState,
                  values
              };
              const event = new CustomEvent('webrtcStatsToRelay', { detail: payload });
              window.dispatchEvent(event);
          }
        } catch (error) {
          WebrtcInternalsExporter.log(`Error in collectStats for ${id}: ${error.message}`);
          this.peerConnections.delete(id); // Stop polling on error
          return;
        }
      }
 
      if (this.peerConnections.has(id)) {
        setTimeout(() => this.collectStats(id), this.updateInterval);
      }
    }
  }

})();
