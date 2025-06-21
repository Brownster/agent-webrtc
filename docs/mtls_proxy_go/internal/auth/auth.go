package auth

import (
	"net/http"

	"mtls-proxy/internal/config"
)

// Middleware verifies the X-API-Key header and attaches customer info.
func Middleware(cfg *config.Manager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			apiKey := r.Header.Get("X-API-Key")
			if apiKey == "" {
				http.Error(w, "Unauthorized: Missing X-API-Key header", http.StatusUnauthorized)
				return
			}
			customer, ok := cfg.Get(apiKey)
			if !ok {
				http.Error(w, "Unauthorized: Invalid API Key", http.StatusUnauthorized)
				return
			}
			r.Header.Set("X-Target-URL", customer.URL)
			r.Header.Set("X-Cert-Path", customer.CertPath)
			r.Header.Set("X-Key-Path", customer.KeyPath)
			next.ServeHTTP(w, r)
		})
	}
}
