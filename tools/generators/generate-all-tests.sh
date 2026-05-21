#!/bin/bash
#
# Generate integration tests for ALL NestJS services
#
# Usage: ./tools/generators/generate-all-tests.sh
#

set -e

echo "🚀 Generating integration tests for all services..."
echo ""

SERVICES=(
  "policies"
  "nodes"
  "queue"
  "license"
)

TOTAL=${#SERVICES[@]}
CURRENT=0

for service in "${SERVICES[@]}"; do
  CURRENT=$((CURRENT + 1))
  echo "[$CURRENT/$TOTAL] Generating tests for: $service"
  npx tsx tools/generators/generate-tests.ts "$service" 2>&1 | grep "✅" || echo "  ⚠️  Skipped (may already exist or service not found)"
  echo ""
done

echo "✅ All test generation complete!"
echo ""
echo "Next steps:"
echo "  1. Run all tests: npx nx test backend"
echo "  2. Review test coverage: npx nx test backend --coverage"
echo ""
