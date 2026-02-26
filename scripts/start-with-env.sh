#!/usr/bin/env bash
set -euo pipefail

# Start standalone runtime with env file loading.
# Usage:
#   ./start-with-env.sh
#   ./start-with-env.sh --env-file .env.production
#   ./start-with-env.sh --env-file /opt/kvideo/.env
#   ./start-with-env.sh --no-env-file

ENV_FILE=".env.production"
USE_ENV_FILE="true"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --env-file)
            ENV_FILE="${2:-}"
            shift 2
            ;;
        --no-env-file)
            USE_ENV_FILE="false"
            shift
            ;;
        -h|--help)
            cat <<'EOF'
Usage: start-with-env.sh [options]

Options:
  --env-file <path>   Load environment variables from file (default: .env.production)
  --no-env-file       Do not load env file
  -h, --help          Show this help
EOF
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

if [[ "${USE_ENV_FILE}" == "true" ]]; then
    if [[ -f "${ENV_FILE}" ]]; then
        echo "==> Loading env file: ${ENV_FILE}"
        set -a
        # shellcheck disable=SC1090
        source "${ENV_FILE}"
        set +a
    else
        echo "Env file not found: ${ENV_FILE}" >&2
        exit 1
    fi
fi

if [[ ! -f "server.js" ]]; then
    echo "server.js not found in current directory: $(pwd)" >&2
    exit 1
fi

if [[ ! -f ".next/BUILD_ID" ]]; then
    echo ".next/BUILD_ID not found. This directory is not a valid standalone runtime package." >&2
    exit 1
fi

export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

echo "==> Starting KVideo"
echo "==> HOSTNAME=${HOSTNAME} PORT=${PORT} NODE_ENV=${NODE_ENV:-production}"

exec node server.js
