#!/usr/bin/with-contenv bashio

export SSL="$(bashio::config 'ssl')"
export CERTFILE="$(bashio::config 'certfile')"
export KEYFILE="$(bashio::config 'keyfile')"
export KEEP_HTTP="$(bashio::config 'keep_http')"
export DOMAIN="$(bashio::config 'domain')"

bashio::log.info "Starting Advance Tools (ssl: ${SSL})..."
exec python3 /app/main.py
