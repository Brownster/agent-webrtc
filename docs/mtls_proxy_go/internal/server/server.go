package server

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/go-chi/chi/v5"

	"mtls-proxy/internal/auth"
	"mtls-proxy/internal/config"
	"mtls-proxy/internal/mtls"
)

// ProxyServer encapsulates the HTTP server and configuration management.
type ProxyServer struct {
	Config   *config.Manager
	router   *chi.Mux
	HTTPPort string
}

// New creates a ProxyServer with routes configured.
func New(cfg *config.Manager) *ProxyServer {
	r := chi.NewRouter()
	ps := &ProxyServer{Config: cfg, router: r, HTTPPort: "3001"}
	r.With(auth.Middleware(cfg)).HandleFunc("/metrics/job/{job}/instance/{instance}", ps.proxyHandler)
	return ps
}

// Start launches the HTTP server and sets up signal handling for reloads.
func (p *ProxyServer) Start() error {
	// initial config load
	if err := p.Config.Load(); err != nil {
		return err
	}
	log.Printf("Configuration loaded: %d customers", p.Config.Count())

	// hot reload on SIGHUP
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGHUP)
	go func() {
		for range sigs {
			if err := p.Config.Load(); err != nil {
				log.Printf("ERROR: config reload failed: %v", err)
			} else {
				log.Printf("Configuration reloaded: %d customers", p.Config.Count())
			}
		}
	}()

	port := os.Getenv("PORT")
	if port != "" {
		p.HTTPPort = port
	}
	log.Printf("Starting mTLS proxy server on port %s", p.HTTPPort)
	return http.ListenAndServe(":"+p.HTTPPort, p.router)
}

// proxyHandler forwards the request using mTLS credentials for the customer.
func (p *ProxyServer) proxyHandler(w http.ResponseWriter, r *http.Request) {
	target := r.Header.Get("X-Target-URL")
	certPath := r.Header.Get("X-Cert-Path")
	keyPath := r.Header.Get("X-Key-Path")

	job := chi.URLParam(r, "job")
	instance := chi.URLParam(r, "instance")
	targetURL := fmt.Sprintf("%s/metrics/job/%s/instance/%s", target, job, instance)

	client, err := mtls.Client(certPath, keyPath)
	if err != nil {
		log.Printf("ERROR: failed to load client certificate: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	proxyReq, err := http.NewRequest(r.Method, targetURL, r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	proxyReq.Header.Set("Content-Type", r.Header.Get("Content-Type"))

	resp, err := client.Do(proxyReq)
	if err != nil {
		log.Printf("ERROR: proxy request failed: %v", err)
		http.Error(w, "Bad Gateway", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
