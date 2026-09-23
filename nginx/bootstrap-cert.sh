#!/bin/sh
# Give nginx something to open on the very first start.
#
# The chicken-and-egg that makes nginx harder than Caddy here: nginx refuses
# to start if ssl_certificate points at a file that does not exist, but
# certbot cannot obtain that file until something is answering on port 80.
#
# So: a throwaway self-signed certificate, just so nginx starts and can serve
# the ACME challenge. certbot replaces it minutes later and the reload loop
# picks the real one up. Runs in the certbot image because it already has
# openssl; the nginx image does not.
set -e

LIVE="/etc/letsencrypt/live/${SITE_ADDRESS}"

if [ -f "${LIVE}/fullchain.pem" ]; then
  echo "certificate already present for ${SITE_ADDRESS} - leaving it alone"
  exit 0
fi

echo "no certificate yet for ${SITE_ADDRESS} - writing a temporary self-signed one"
mkdir -p "${LIVE}"
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -keyout "${LIVE}/privkey.pem" \
  -out    "${LIVE}/fullchain.pem" \
  -subj   "/CN=${SITE_ADDRESS}" 2>/dev/null

echo "done - nginx can start, certbot will replace this"
