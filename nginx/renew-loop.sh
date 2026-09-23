#!/bin/sh
# Obtain the certificate, then keep it alive.
#
# In a script rather than inline in docker-compose.yml on purpose: the command
# needs quoting, a loop and a trap, and YAML folded scalars treat backslashes
# literally — an escaped quote written there reaches certbot as part of the
# hostname. A file has none of that ambiguity.
#
# --keep-until-expiring makes this safe to run every 12h: certbot does nothing
# until the certificate is inside 30 days of expiry, so there is no cron to
# forget and no risk of burning the five-per-week issuance limit.
set -u

trap 'exit 0' TERM INT

while :; do
  certbot certonly \
    --webroot -w /var/www/certbot \
    -d "${SITE_ADDRESS}" \
    --email "${LETSENCRYPT_EMAIL}" \
    --agree-tos --no-eff-email \
    --keep-until-expiring \
    --non-interactive || echo "certbot run failed; retrying in 12h"

  sleep 12h
done
