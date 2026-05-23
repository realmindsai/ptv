#!/usr/bin/env bash
# Source AFTER `./scripts/decrypt-env.sh && set -a && source .env && set +a`
# to override the docker-DNS peer URLs (which only resolve inside totoro's
# docker network) with tailscale MagicDNS URLs (which resolve from any
# device on the magpie-inconnu tailnet).
#
# Production (the ptv-chat container running on totoro) ignores these
# overrides because its docker-compose `environment:` block re-asserts
# the docker-DNS URLs at container start. Only ad-hoc dev shells benefit.

export NOMINATIM_URL=http://totoro.magpie-inconnu.ts.net:8094
export PHOTON_URL=http://totoro.magpie-inconnu.ts.net:2322
export GH_REST_URL=http://totoro.magpie-inconnu.ts.net:8989/route
export OSRM_AU_BICYCLE_URL=http://totoro.magpie-inconnu.ts.net:5002
export OSRM_AU_FOOT_URL=http://totoro.magpie-inconnu.ts.net:5003
