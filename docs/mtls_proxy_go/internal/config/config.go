package config

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

// CustomerInfo holds the configuration for a single customer.
type CustomerInfo struct {
	URL      string `json:"url"`
	CertPath string `json:"certPath"`
	KeyPath  string `json:"keyPath"`
}

// Manager handles loading and reloading configuration files.
type Manager struct {
	Path string
	mu   sync.RWMutex
	data map[string]CustomerInfo
}

// NewManager creates a new config manager with the given path.
func NewManager(path string) *Manager {
	return &Manager{Path: path}
}

// Load reads the configuration from disk and replaces the current config.
func (m *Manager) Load() error {
	contents, err := os.ReadFile(m.Path)
	if err != nil {
		return fmt.Errorf("failed to read config file: %w", err)
	}
	var cfg map[string]CustomerInfo
	if err := json.Unmarshal(contents, &cfg); err != nil {
		return fmt.Errorf("failed to parse config: %w", err)
	}
	m.mu.Lock()
	m.data = cfg
	m.mu.Unlock()
	return nil
}

// Get returns the customer info for the given API key.
func (m *Manager) Get(apiKey string) (CustomerInfo, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	c, ok := m.data[apiKey]
	return c, ok
}

// Count returns how many customers are configured.
func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.data)
}
