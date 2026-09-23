#!/bin/sh
# Pick up renewed certificates.
#
# certbot writes a new certificate into the shared volume every ~60 days, but
# nginx has already opened the old one and will keep serving it until told
# otherwise — so without this the site starts failing exactly 90 days after it
# was set up, which is long enough to have forgotten why.
#
# The official nginx image runs everything in /docker-entrypoint.d before
# starting nginx, so this backgrounds itself and the first reload is a day
# away, by which time nginx is long up.
(
  while :; do
    sleep 12h
    nginx -s reload 2>/dev/null || true
  done
) &
