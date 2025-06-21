package main

import (
	"log"

	"mtls-proxy/internal/config"
	"mtls-proxy/internal/server"
)

func main() {
	cfg := config.NewManager("./proxy-config.json")
	srv := server.New(cfg)
	if err := srv.Start(); err != nil {
		log.Fatalf("FATAL: %v", err)
	}
}
