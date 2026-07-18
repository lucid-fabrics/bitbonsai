#!/bin/bash
# BitBonsai - Deploy to Unraid (thin wrapper)
#
# The canonical build/deploy/rollback logic lives in
# scripts/deploy-production.sh (also used for ad hoc production-build
# testing without a full Unraid deploy). This wrapper adds the Unraid-
# specific NFS preflight check, then delegates.
#
# Reflects the actual running deployment as of 2026-07-18: ONE container
# named "bitbonsai", built from Dockerfile.prod's "production" target
# (embedded PostgreSQL, nginx + backend on port 8108) - not the older
# split backend/frontend docker-compose setup some docs still describe.

set -e

UNRAID_HOST="${UNRAID_HOST:-unraid}"
UNRAID_USER="${UNRAID_USER:-root}"
UNRAID_SSH="${UNRAID_USER}@${UNRAID_HOST}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Deploying BitBonsai to Unraid..."
echo ""

# Pre-flight: Check Unraid NFS configuration (only relevant for LINKED child
# nodes; a single-node MAIN-only deployment doesn't need it).
echo "Pre-flight: checking Unraid NFS configuration..."
NFS_EXPORTS=$(ssh "$UNRAID_SSH" 'showmount -e localhost 2>&1' || echo "NFS_ERROR")
if echo "$NFS_EXPORTS" | grep -q "/mnt/user/media\|/mnt/user/Downloads"; then
    echo "NFS exports detected:"
    echo "$NFS_EXPORTS" | grep -E "/mnt/user/(media|Downloads)" || true
else
    echo "WARNING: Unraid NFS exports not configured (only needed for LINKED child nodes)."
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi
echo ""

exec "$SCRIPT_DIR/deploy-production.sh" "$@"
