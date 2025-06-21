# Go mTLS Proxy

This directory contains a reference implementation of the mTLS proxy described in
`docs/mtls_proxy`. It replaces the Node.js example with a production ready Go
version.

## Features

- Configuration loaded from `proxy-config.json` with hot reload via `SIGHUP`.
- API key authentication middleware.
- Request forwarding to the customer Pushgateway using mutual TLS.
- Modular packages for configuration, authentication, TLS helpers and the server.

## Building

1. Install Go 1.20 or newer.
2. Run `go build ./cmd/proxy` to build the binary.

```
go build -o webrtc-proxy ./cmd/proxy
```

## Running

1. Copy `proxy-config.json` to the working directory.
2. Run the binary and optionally set `PORT` for the HTTP port.

```
./webrtc-proxy
```

Send `SIGHUP` to reload configuration without restarting.

## Configuration Format

`proxy-config.json` maps API keys to their Pushgateway URL and client certificates:

```json
{
  "customer-api-key": {
    "url": "http://pushgateway.example:9091",
    "certPath": "/etc/pki/webrtc-proxy/customer.crt",
    "keyPath": "/etc/pki/webrtc-proxy/customer.key"
  }
}
```

## Onboarding Customers

Use `onboard_customer.sh` to generate certificates and append a new entry to the
configuration file. The script then reloads the proxy service.
