#!/bin/bash

set -e

PROXY_CONFIG_FILE="/opt/webrtc-proxy/proxy-config.js"
CERTS_DIR="/etc/pki/webrtc-proxy/certs"
CA_KEY="/etc/pki/webrtc-proxy/ca.key"
CA_CERT="/etc/pki/webrtc-proxy/ca.crt"
VALIDITY_DAYS=730
PROXY_SERVICE_NAME="webrtc-proxy"
# Base URL for the proxy used in the final output. Can be overridden by
# setting the PROXY_BASE_URL environment variable before running the script.
PROXY_BASE_URL="${PROXY_BASE_URL:-https://$(hostname -f)}"

print_usage() {
  echo "Usage: $0 \"Customer Name\""
}

if [ -z "$1" ]; then
  echo "Error: Customer name is required." >&2
  print_usage
  exit 1
fi

CUSTOMER_NAME="$1"
SAFE_NAME=$(echo "$CUSTOMER_NAME" | tr -s '[:punct:][:space:]' '_' | tr '[:upper:]' '[:lower:]')

CLIENT_KEY="$CERTS_DIR/${SAFE_NAME}.key"
CLIENT_CERT="$CERTS_DIR/${SAFE_NAME}.crt"
CLIENT_CSR="$CERTS_DIR/${SAFE_NAME}.csr"

if [ -f "$CLIENT_KEY" ]; then
  echo "Error: Customer already exists." >&2
  exit 1
fi

mkdir -p "$CERTS_DIR"
API_KEY="cust_$(uuidgen)"

echo "Generating private key..."
openssl genpkey -algorithm RSA -out "$CLIENT_KEY" -pkeyopt rsa_keygen_bits:2048
chmod 400 "$CLIENT_KEY"

echo "Generating CSR..."
openssl req -new -key "$CLIENT_KEY" -out "$CLIENT_CSR" -subj "/C=US/O=$CUSTOMER_NAME/CN=$SAFE_NAME.client"

echo "Signing certificate..."
openssl x509 -req -in "$CLIENT_CSR" -CA "$CA_CERT" -CAkey "$CA_KEY" -CAcreateserial -out "$CLIENT_CERT" -days $VALIDITY_DAYS -sha256
rm "$CLIENT_CSR"

echo "Enter the customer's Pushgateway URL:"
read PUSHGATEWAY_URL

NEW_ENTRY="  '${API_KEY}': { url: '${PUSHGATEWAY_URL}', certPath: '${CLIENT_CERT}', keyPath: '${CLIENT_KEY}' },"
sed -i "/^};/i\${NEW_ENTRY}" "$PROXY_CONFIG_FILE"

echo "Reloading proxy service..."
if ! systemctl reload "$PROXY_SERVICE_NAME"; then
  echo "Warning: Could not reload service ${PROXY_SERVICE_NAME}." >&2
fi

echo "\nCustomer Onboarding Complete"
echo "API Key: $API_KEY"
echo "Proxy URL: ${PROXY_BASE_URL}/metrics/job/{job}/instance/{id}"
