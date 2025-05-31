/**
 * Storage abstraction layer for WebRTC Stats Exporter
 * Centralized storage management with error handling and validation
 */

/**
 * Storage management utility class
 * Provides consistent interface for Chrome extension storage with error handling
 */
class StorageManager {
  /**
   * Get data from chrome.storage.sync with error handling
   * @param {string|string[]|Object} keys - Keys to retrieve
   * @returns {Promise<Object>} Retrieved data
   */
  static async get(keys = null) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[StorageManager] Chrome storage not available, using fallback');
        return StorageManager._getFallback(keys);
      }
      
      const result = await chrome.storage.sync.get(keys);
      
      // Validate retrieved configuration if getting all options
      if (!keys || (Array.isArray(keys) && keys.includes('url'))) {
        const config = globalThis.WebRTCExporterConfig || self.WebRTCExporterConfig || window.WebRTCExporterConfig;
        if (config) {
          const validation = config.validateConfig(result);
          if (!validation.isValid) {
            console.warn('[StorageManager] Invalid config detected:', validation.errors);
            // Return defaults for invalid config
            return { ...config.DEFAULT_OPTIONS, ...result };
          }
        }
      }
      
      return result;
    } catch (error) {
      console.error('[StorageManager] Error getting data from storage:', error);
      throw new StorageError('Failed to retrieve data from storage', error);
    }
  }
  
  /**
   * Set data to chrome.storage.sync with validation and error handling
   * @param {Object} data - Data to store
   * @returns {Promise<void>}
   */
  static async set(data) {
    try {
      if (!data || typeof data !== 'object') {
        throw new Error('Data must be a non-null object');
      }
      
      // Validate configuration before storing
      const config = globalThis.WebRTCExporterConfig || self.WebRTCExporterConfig || window.WebRTCExporterConfig;
      if (config) {
        const validation = config.validateConfig(data);
        if (!validation.isValid) {
          throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
        }
      }
      
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[StorageManager] Chrome storage not available, using fallback');
        return StorageManager._setFallback(data);
      }
      
      await chrome.storage.sync.set(data);
      console.log('[StorageManager] Successfully saved configuration');
    } catch (error) {
      console.error('[StorageManager] Error setting data to storage:', error);
      throw new StorageError('Failed to save data to storage', error);
    }
  }
  
  /**
   * Get data from chrome.storage.local (for temporary/large data)
   * @param {string|string[]|Object} keys - Keys to retrieve
   * @returns {Promise<Object>} Retrieved data
   */
  static async getLocal(keys = null) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[StorageManager] Chrome storage not available, using fallback');
        return {};
      }
      
      return await chrome.storage.local.get(keys);
    } catch (error) {
      console.error('[StorageManager] Error getting local data:', error);
      throw new StorageError('Failed to retrieve local data', error);
    }
  }
  
  /**
   * Set data to chrome.storage.local
   * @param {Object} data - Data to store
   * @returns {Promise<void>}
   */
  static async setLocal(data) {
    try {
      if (!data || typeof data !== 'object') {
        throw new Error('Data must be a non-null object');
      }
      
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[StorageManager] Chrome storage not available');
        return;
      }
      
      await chrome.storage.local.set(data);
    } catch (error) {
      console.error('[StorageManager] Error setting local data:', error);
      throw new StorageError('Failed to save local data', error);
    }
  }
  
  /**
   * Remove data from storage
   * @param {string|string[]} keys - Keys to remove
   * @returns {Promise<void>}
   */
  static async remove(keys) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        return;
      }
      
      await chrome.storage.sync.remove(keys);
    } catch (error) {
      console.error('[StorageManager] Error removing data:', error);
      throw new StorageError('Failed to remove data from storage', error);
    }
  }
  
  /**
   * Clear all storage data
   * @returns {Promise<void>}
   */
  static async clear() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        return;
      }
      
      await chrome.storage.sync.clear();
      await chrome.storage.local.clear();
    } catch (error) {
      console.error('[StorageManager] Error clearing storage:', error);
      throw new StorageError('Failed to clear storage', error);
    }
  }
  
  /**
   * Get merged options (defaults + stored)
   * @returns {Promise<Object>} Complete options object
   */
  static async getOptions() {
    try {
      const config = globalThis.WebRTCExporterConfig || self.WebRTCExporterConfig || window.WebRTCExporterConfig;
      const defaultOptions = config ? config.DEFAULT_OPTIONS : {};
      
      const stored = await StorageManager.get();
      const options = { ...defaultOptions, ...stored };
      
      // Ensure enabledStats is always an array
      if (options.enabledStats && !Array.isArray(options.enabledStats)) {
        options.enabledStats = Object.values(options.enabledStats || {});
      }
      
      return options;
    } catch (error) {
      console.error('[StorageManager] Error getting options, using defaults:', error);
      const config = globalThis.WebRTCExporterConfig || self.WebRTCExporterConfig || window.WebRTCExporterConfig;
      return config ? { ...config.DEFAULT_OPTIONS } : {};
    }
  }
  
  /**
   * Update specific option(s)
   * @param {Object} updates - Options to update
   * @returns {Promise<Object>} Updated complete options
   */
  static async updateOptions(updates) {
    try {
      const current = await StorageManager.getOptions();
      const updated = { ...current, ...updates };
      await StorageManager.set(updated);
      return updated;
    } catch (error) {
      console.error('[StorageManager] Error updating options:', error);
      throw error;
    }
  }
  
  /**
   * Get statistics data
   * @returns {Promise<Object>} Statistics object
   */
  static async getStats() {
    try {
      const config = globalThis.WebRTCExporterConfig || self.WebRTCExporterConfig || window.WebRTCExporterConfig;
      const storageKeys = config ? config.CONSTANTS.STORAGE_KEYS : {};
      
      const keys = [
        storageKeys.PEER_CONNECTIONS_PER_ORIGIN,
        storageKeys.MESSAGES_SENT,
        storageKeys.BYTES_SENT,
        storageKeys.TOTAL_TIME,
        storageKeys.ERRORS,
      ].filter(Boolean);
      
      return await StorageManager.getLocal(keys);
    } catch (error) {
      console.error('[StorageManager] Error getting stats:', error);
      return {};
    }
  }
  
  /**
   * Update statistics
   * @param {Object} stats - Statistics to update
   * @returns {Promise<void>}
   */
  static async updateStats(stats) {
    try {
      await StorageManager.setLocal(stats);
    } catch (error) {
      console.error('[StorageManager] Error updating stats:', error);
      // Don't throw for stats errors to avoid breaking main functionality
    }
  }
  
  /**
   * Listen for storage changes
   * @param {Function} callback - Callback function for changes
   * @returns {Function} Unsubscribe function
   */
  static onChanged(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return () => {}; // Return empty unsubscribe function
    }
    
    const listener = (changes, areaName) => {
      if (areaName === 'sync') {
        callback(changes);
      }
    };
    
    chrome.storage.onChanged.addListener(listener);
    
    // Return unsubscribe function
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }
  
  // Fallback methods for testing/development
  static _getFallback(keys) {
    if (typeof localStorage === 'undefined') return {};
    
    try {
      const stored = localStorage.getItem('webrtc-exporter-config');
      const data = stored ? JSON.parse(stored) : {};
      
      if (!keys) return data;
      if (typeof keys === 'string') return { [keys]: data[keys] };
      if (Array.isArray(keys)) {
        return keys.reduce((result, key) => {
          result[key] = data[key];
          return result;
        }, {});
      }
      
      return data;
    } catch (error) {
      console.error('[StorageManager] Fallback get error:', error);
      return {};
    }
  }
  
  static _setFallback(data) {
    if (typeof localStorage === 'undefined') return;
    
    try {
      const current = JSON.parse(localStorage.getItem('webrtc-exporter-config') || '{}');
      const updated = { ...current, ...data };
      localStorage.setItem('webrtc-exporter-config', JSON.stringify(updated));
    } catch (error) {
      console.error('[StorageManager] Fallback set error:', error);
    }
  }
}

/**
 * Custom error class for storage operations
 */
class StorageError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = 'StorageError';
    this.originalError = originalError;
  }
}

// Global export for Chrome extension compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.WebRTCExporterStorage = {
    StorageManager,
    StorageError,
  };
} else if (typeof window !== 'undefined') {
  window.WebRTCExporterStorage = {
    StorageManager,
    StorageError,
  };
} else if (typeof self !== 'undefined') {
  self.WebRTCExporterStorage = {
    StorageManager,
    StorageError,
  };
}