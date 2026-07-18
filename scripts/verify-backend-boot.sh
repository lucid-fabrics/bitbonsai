#!/bin/bash
# Boots the built production backend bundle just far enough to prove NestJS
# dependency injection resolves cleanly, without needing a real database.
#
# This exists because of a 2026-07-17 production outage: two module-wiring
# bugs (a plain import in a circular module dependency, and a repository
# only provided in one module while a global guard needed it everywhere)
# passed lint, `nx build`, and 5000+ unit tests, then crashed the bundle at
# startup with "Nest can't resolve dependencies" / "cannot create the X
# instance". None of those checks actually construct the Nest application -
# unit tests mock their own providers, so a real DI wiring mistake is
# invisible to them. This script closes that gap by running the actual
# built bundle and asserting it doesn't hit those specific errors, using a
# database URL that intentionally doesn't resolve (a Prisma P1001 timeout is
# the EXPECTED, passing outcome here - it means the app got past module
# construction and only failed on the network call CI can't provide).
set -uo pipefail

cd "$(dirname "$0")/.."

BUNDLE="dist/apps/backend/main.js"
if [ ! -f "$BUNDLE" ]; then
  echo "verify-backend-boot: $BUNDLE not found - run 'nx build backend' first"
  exit 1
fi

LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT

NODE_ENV=production \
DATABASE_URL="postgresql://boot-check:boot-check@127.0.0.1:1/boot_check" \
LICENSING_SERVICE_URL="http://127.0.0.1:1/api" \
LICENSING_ADMIN_API_KEY="boot-check-admin-key" \
JWT_SECRET="boot-check-secret-boot-check-secret-32" \
timeout 30 node "$BUNDLE" > "$LOG" 2>&1

# Known NestJS dependency-injection wiring error shapes. Not exhaustive (any
# fixed string list can miss a differently-worded DI bug), but covers every
# variant seen so far, including the 2026-07-17 incident. Keep in sync with
# the identical pattern in scripts/deploy-production.sh.
DI_ERROR_PATTERN="can't resolve dependencies|cannot create the .* instance|UnknownExportException|UnknownElementException|is not part of the currently processed module"

if grep -qiE "$DI_ERROR_PATTERN" "$LOG"; then
  echo "BOOT CHECK FAILED: NestJS dependency injection error detected in the built bundle."
  echo "----- backend boot log -----"
  cat "$LOG"
  exit 1
fi

echo "Boot check passed: no DI resolution errors. (A database connection failure in the log above is expected - there is no live database in this check.)"
