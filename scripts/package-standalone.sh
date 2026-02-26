#!/usr/bin/env bash
set -euo pipefail

# Build and package Next.js standalone output for deployment to low-spec servers.
# Usage:
#   ./scripts/package-standalone.sh
#   ./scripts/package-standalone.sh --skip-install --output-dir release-out --archive-name kvideo-release.tgz

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

OUTPUT_DIR="release"
ARCHIVE_NAME=""
SKIP_INSTALL="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-install)
            SKIP_INSTALL="true"
            shift
            ;;
        --output-dir)
            OUTPUT_DIR="${2:-}"
            shift 2
            ;;
        --archive-name)
            ARCHIVE_NAME="${2:-}"
            shift 2
            ;;
        -h|--help)
            cat <<'EOF'
Usage: package-standalone.sh [options]

Options:
  --skip-install            Skip dependency installation
  --output-dir <dir>        Output directory for assembled release (default: release)
  --archive-name <name>     Archive file name (default: kvideo-release-<timestamp>-<git>.tgz)
  -h, --help                Show this help
EOF
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

if [[ -z "${OUTPUT_DIR}" ]]; then
    echo "Invalid --output-dir value" >&2
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "node is required but not found." >&2
    exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
    echo "tar is required but not found." >&2
    exit 1
fi

cd "${PROJECT_ROOT}"

GIT_SHA="nogit"
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
    GIT_SHA="$(git rev-parse --short HEAD)"
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
if [[ -z "${ARCHIVE_NAME}" ]]; then
    ARCHIVE_NAME="kvideo-release-${TIMESTAMP}-${GIT_SHA}.tgz"
fi

echo "==> Project: ${PROJECT_ROOT}"
echo "==> Node: $(node --version)"
echo "==> Output dir: ${OUTPUT_DIR}"
echo "==> Archive: ${ARCHIVE_NAME}"

if [[ "${SKIP_INSTALL}" != "true" ]]; then
    echo "==> Installing dependencies..."
    if [[ -f yarn.lock ]]; then
        yarn --frozen-lockfile --network-timeout 600000
    elif [[ -f package-lock.json ]]; then
        npm ci --no-audit --prefer-offline --progress=false
    elif [[ -f pnpm-lock.yaml ]]; then
        corepack enable pnpm
        pnpm i --frozen-lockfile
    else
        echo "No lockfile found. Cannot install dependencies deterministically." >&2
        exit 1
    fi
else
    echo "==> Skip install enabled."
fi

echo "==> Building production bundle..."
NEXT_TELEMETRY_DISABLED=1 npm run build

if [[ ! -f ".next/standalone/server.js" ]]; then
    echo "Build output missing: .next/standalone/server.js" >&2
    exit 1
fi

echo "==> Assembling standalone release..."
rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

# IMPORTANT: use '/.' to include hidden files under standalone (e.g. .next/BUILD_ID)
cp -a .next/standalone/. "${OUTPUT_DIR}/"
mkdir -p "${OUTPUT_DIR}/.next"
cp -a .next/static/. "${OUTPUT_DIR}/.next/static/"
cp -a public/. "${OUTPUT_DIR}/public/"

cat > "${OUTPUT_DIR}/run.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
PORT="${PORT:-3000}"
HOSTNAME="${HOSTNAME:-0.0.0.0}"
exec node server.js
EOF
chmod +x "${OUTPUT_DIR}/run.sh"

echo "==> Packaging archive..."
tar -czf "${ARCHIVE_NAME}" -C "${OUTPUT_DIR}" .

if command -v sha256sum >/dev/null 2>&1; then
    SHA256_VALUE="$(sha256sum "${ARCHIVE_NAME}" | awk '{print $1}')"
    echo "==> SHA256: ${SHA256_VALUE}"
fi

echo
echo "Package generated successfully:"
echo "  ${PROJECT_ROOT}/${ARCHIVE_NAME}"
echo
echo "Deploy on low-spec server:"
echo "  1) tar -xzf ${ARCHIVE_NAME} -C /opt/kvideo"
echo "  2) cd /opt/kvideo"
echo "  3) PORT=23007 HOSTNAME=0.0.0.0 ./run.sh"
