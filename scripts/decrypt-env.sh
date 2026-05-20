#!/usr/bin/env bash
# Decrypt .env.sops -> .env at the ptv repo root.
# Run before `docker compose up` to refresh runtime credentials.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env.sops ]]; then
  echo "decrypt-env.sh: .env.sops not found at $(pwd)/.env.sops" >&2
  exit 1
fi

# Locate an age key. /home preferred (matches sops-decrypt-env), /etc fallback.
if [[ -z "${SOPS_AGE_KEY_FILE:-}" ]]; then
  if   [[ -r "${HOME}/.config/sops/age/keys.txt" ]]; then export SOPS_AGE_KEY_FILE="${HOME}/.config/sops/age/keys.txt"
  elif [[ -r /etc/age/keys.txt                 ]]; then export SOPS_AGE_KEY_FILE=/etc/age/keys.txt
  else
    echo "decrypt-env.sh: no age key (set SOPS_AGE_KEY_FILE or place keys.txt)" >&2
    exit 1
  fi
fi

umask 0177
sops --decrypt --input-type dotenv --output-type dotenv .env.sops > .env
chmod 0640 .env
echo "decrypt-env.sh: wrote .env from .env.sops"
