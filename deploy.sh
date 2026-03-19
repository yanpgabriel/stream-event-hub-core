#!/bin/bash
# Stream Event Hub Core deploy script
# Usage: ./deploy.sh

set -e
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-${SCRIPT_DIR}/.deploy.env}"

if [[ -f "${DEPLOY_ENV_FILE}" ]]; then
    # shellcheck disable=SC1090
    source "${DEPLOY_ENV_FILE}"
fi

REMOTE_USER="${DEPLOY_REMOTE_USER:-}"
REMOTE_HOST="${DEPLOY_REMOTE_HOST:-}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-}"
CONTAINER_NAME="${DEPLOY_CONTAINER_NAME:-stream-event-hub-core}"
IMAGE_NAME="${DEPLOY_IMAGE_NAME:-stream-event-hub-core}"
PORT="${DEPLOY_PORT:-3232}"
DATA_VOLUME="${DEPLOY_DATA_VOLUME:-}"
SSH_KEY_PATH="${DEPLOY_SSH_KEY_PATH:-}"
SSH_PORT="${DEPLOY_SSH_PORT:-}"
USE_SUDO="${DEPLOY_USE_SUDO:-true}"
DOCKER_CONFIG_DIR="${DEPLOY_DOCKER_CONFIG_DIR:-${REMOTE_DIR}/.docker}"
SSH_OPTS=(
    -o StrictHostKeyChecking=accept-new
    -o ConnectTimeout=10
    -o ServerAliveInterval=30
    -o ServerAliveCountMax=3
)

if [[ -z "${REMOTE_USER}" || -z "${REMOTE_HOST}" || -z "${REMOTE_DIR}" || -z "${DATA_VOLUME}" ]]; then
    echo "Missing deploy configuration."
    echo "Set DEPLOY_REMOTE_USER, DEPLOY_REMOTE_HOST, DEPLOY_REMOTE_DIR and DEPLOY_DATA_VOLUME in environment or .deploy.env."
    exit 1
fi

SSH_TARGET="${REMOTE_USER}@${REMOTE_HOST}"

if [[ -n "${DEPLOY_SSH_PASSWORD:-}" || -n "${DEPLOY_SUDO_PASSWORD:-}" ]]; then
    echo "Password-based deploy variables are no longer supported."
    echo "Configure SSH keys for ${SSH_TARGET} and use passwordless sudo on the remote host, or set DEPLOY_USE_SUDO=false."
    exit 1
fi

if [[ -n "${SSH_PORT}" ]]; then
    SSH_OPTS+=(-p "${SSH_PORT}")
fi

if [[ -n "${SSH_KEY_PATH}" ]]; then
    if [[ ! -f "${SSH_KEY_PATH}" ]]; then
        echo "DEPLOY_SSH_KEY_PATH does not exist: ${SSH_KEY_PATH}"
        exit 1
    fi
    SSH_OPTS+=(-i "${SSH_KEY_PATH}")
fi

RSYNC_SSH="ssh"
for opt in "${SSH_OPTS[@]}"; do
    RSYNC_SSH+=" $(printf '%q' "${opt}")"
done

if [[ "${USE_SUDO}" =~ ^(1|true|yes|on)$ ]]; then
    SUDO_PREFIX="sudo -n "
else
    SUDO_PREFIX=""
fi

run_remote() {
    local command="$1"
    ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "${command}"
}

run_rsync() {
    rsync "$@"
}

echo "🚀 Stream Event Hub Core Deploy"
echo "====================="

# 1. Sync files
echo ""
echo "📦 Step 1/3: Syncing files..."
run_rsync -rlvz \
    --no-perms --no-times \
    --exclude 'node_modules' \
    --exclude 'server/node_modules' \
    --exclude 'data/' \
    --exclude 'server/data/' \
    --exclude '.DS_Store' \
    --exclude '.git' \
    --exclude '.gitignore' \
    --exclude '.deploy.env' \
    -e "${RSYNC_SSH}" \
    "${SCRIPT_DIR}/" \
    "${SSH_TARGET}:${REMOTE_DIR}/" || [ $? -eq 23 ]

echo "✅ Files synced."

run_remote "mkdir -p ${DOCKER_CONFIG_DIR}"

# 2. Build Docker image
echo ""
echo "🔨 Step 2/3: Building Docker image..."
run_remote "${SUDO_PREFIX}DOCKER_CONFIG=${DOCKER_CONFIG_DIR} docker build -t ${IMAGE_NAME} -f ${REMOTE_DIR}/Dockerfile ${REMOTE_DIR}/ 2>&1"

echo "✅ Image built."

# 3. Restart container
echo ""
echo "🔄 Step 3/3: Restarting container..."
echo "⏳ Waiting for container readiness..."
run_remote "${SUDO_PREFIX}DOCKER_CONFIG=${DOCKER_CONFIG_DIR} docker stop ${CONTAINER_NAME} 2>/dev/null || true && \
     ${SUDO_PREFIX}DOCKER_CONFIG=${DOCKER_CONFIG_DIR} docker rm ${CONTAINER_NAME} 2>/dev/null || true && \
     ${SUDO_PREFIX}DOCKER_CONFIG=${DOCKER_CONFIG_DIR} docker run -d \
         --name ${CONTAINER_NAME} \
         -p ${PORT}:${PORT} \
         --restart unless-stopped \
         -v ${DATA_VOLUME} \
         ${IMAGE_NAME} && \
     for attempt in \$(seq 1 30); do \
         status=\$(${SUDO_PREFIX}DOCKER_CONFIG=${DOCKER_CONFIG_DIR} docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' ${CONTAINER_NAME} 2>/dev/null || echo missing); \
         if [ \"\$status\" = healthy ] || [ \"\$status\" = running ]; then \
             ${SUDO_PREFIX}DOCKER_CONFIG=${DOCKER_CONFIG_DIR} docker logs --tail 5 ${CONTAINER_NAME}; \
             exit 0; \
         fi; \
         if [ \"\$status\" = unhealthy ] || [ \"\$status\" = exited ] || [ \"\$status\" = dead ] || [ \"\$status\" = missing ]; then \
             ${SUDO_PREFIX}DOCKER_CONFIG=${DOCKER_CONFIG_DIR} docker logs --tail 50 ${CONTAINER_NAME} 2>/dev/null || true; \
             exit 1; \
         fi; \
         sleep 2; \
     done; \
     ${SUDO_PREFIX}DOCKER_CONFIG=${DOCKER_CONFIG_DIR} docker logs --tail 50 ${CONTAINER_NAME} 2>/dev/null || true; \
     exit 1"

echo ""
echo "✅ Deploy complete!"
echo "   Health:  http://${REMOTE_HOST}:${PORT}/api/health/ready"
echo "   Status:  http://${REMOTE_HOST}:${PORT}/api/status"
echo "   Webhook: http://${REMOTE_HOST}:${PORT}/webhooks/livepix"
