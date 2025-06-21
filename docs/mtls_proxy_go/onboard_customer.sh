#!/bin/bash
set -e

PROXY_CONFIG_FILE="/opt/webrtc-proxy/proxy-config.json"
CERTS_DIR="/etc/pki/webrtc-proxy/certs"
CA_KEY="/etc/pki/webrtc-proxy/ca.key"
CA_CERT="/etc/pki/webrtc-proxy/ca.crt"
VALIDITY_DAYS=730
PROXY_SERVICE_NAME="webrtc-proxy"
# Base URL for the proxy used in the final output. Override with PROXY_BASE_URL
# environment variable if needed.
PROXY_BASE_URL="${PROXY_BASE_URL:-https://$(hostname -f)}"

if [ -z "$1" ]; then
    echo "Usage: $0 'Customer Name'" >&2
    exit 1
fi

CUSTOMER_NAME="$1"
SAFE_NAME=$(echo "$CUSTOMER_NAME" | tr -s '[:punct:][:space:]' '_' | tr '[:upper:]' '[:lower:]')

mkdir -p "$CERTS_DIR"
CLIENT_KEY="$CERTS_DIR/${SAFE_NAME}.key"
CLIENT_CERT="$CERTS_DIR/${SAFE_NAME}.crt"
CLIENT_CSR="$CERTS_DIR/${SAFE_NAME}.csr"

if [ -f "$CLIENT_KEY" ]; then
    echo "Error: customer already exists" >&2
    exit 1
fi

API_KEY="cust_$(uuidgen)"

openssl genpkey -algorithm RSA -out "$CLIENT_KEY" -pkeyopt rsa_keygen_bits:2048
chmod 400 "$CLIENT_KEY"
openssl req -new -key "$CLIENT_KEY" -out "$CLIENT_CSR" -subj "/C=US/O=$CUSTOMER_NAME/CN=$SAFE_NAME.client"
openssl x509 -req -in "$CLIENT_CSR" -CA "$CA_CERT" -CAkey "$CA_KEY" -CAcreateserial -out "$CLIENT_CERT" -days $VALIDITY_DAYS -sha256
rm "$CLIENT_CSR"

echo "Enter the customer's Pushgateway URL:"
read PUSHGATEWAY_URL

TMP_FILE=$(mktemp)
if [ ! -f "$PROXY_CONFIG_FILE" ]; then
    echo '{}' > "$PROXY_CONFIG_FILE"
fi

jq ". + {\"$API_KEY\": {url: \"$PUSHGATEWAY_URL\", certPath: \"$CLIENT_CERT\", keyPath: \"$CLIENT_KEY\"}}" "$PROXY_CONFIG_FILE" > "$TMP_FILE"
mv "$TMP_FILE" "$PROXY_CONFIG_FILE"

if systemctl reload "$PROXY_SERVICE_NAME"; then
    echo "Proxy reloaded"
else
    echo "Warning: could not reload service" >&2
fi

echo "\nCustomer Onboarding Complete"
echo "API Key: $API_KEY"
echo "Proxy URL: ${PROXY_BASE_URL}/metrics/job/{job}/instance/{id}"
