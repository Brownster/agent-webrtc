package mtls

import (
	"crypto/tls"
	"net/http"
)

// Client returns an http.Client configured for mutual TLS using the provided cert and key.
func Client(certPath, keyPath string) (*http.Client, error) {
	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, err
	}
	tlsConfig := &tls.Config{Certificates: []tls.Certificate{cert}}
	transport := &http.Transport{TLSClientConfig: tlsConfig}
	return &http.Client{Transport: transport}, nil
}
