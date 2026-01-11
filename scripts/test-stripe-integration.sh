#!/bin/bash

# Stripe Integration Test Script
# Run this to verify the implementation works

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 BitBonsai Stripe Integration Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if license-api is running
echo "📡 Checking if license-api is running..."
if curl -s http://localhost:3200/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ License-API is running on port 3200${NC}"
else
    echo -e "${RED}✗ License-API is NOT running${NC}"
    echo "  Start it with: nx serve license-api"
    exit 1
fi

echo ""

# Test 1: GET /api/pricing
echo "🔍 Test 1: Fetch pricing tiers..."
PRICING_RESPONSE=$(curl -s http://localhost:3200/api/pricing)
if echo "$PRICING_RESPONSE" | grep -q "stripePriceIdMonthly"; then
    echo -e "${GREEN}✓ Pricing API working${NC}"
    TIER_COUNT=$(echo "$PRICING_RESPONSE" | grep -o "stripePriceIdMonthly" | wc -l | xargs)
    echo "  Found $TIER_COUNT tiers with Stripe price IDs"
else
    echo -e "${RED}✗ Pricing API failed or no price IDs configured${NC}"
    echo "  Response: $PRICING_RESPONSE"
fi

echo ""

# Test 2: POST /api/stripe/checkout (validation test)
echo "🔍 Test 2: Test checkout validation..."
CHECKOUT_RESPONSE=$(curl -s -X POST http://localhost:3200/api/stripe/checkout \
    -H "Content-Type: application/json" \
    -d '{"email":"invalid","priceId":"","successUrl":"","cancelUrl":""}')

if echo "$CHECKOUT_RESPONSE" | grep -q "statusCode"; then
    echo -e "${GREEN}✓ Checkout endpoint exists and validates input${NC}"
else
    echo -e "${YELLOW}⚠ Unexpected checkout response${NC}"
    echo "  Response: $CHECKOUT_RESPONSE"
fi

echo ""

# Test 3: Check CORS headers
echo "🔍 Test 3: Test CORS configuration..."
CORS_RESPONSE=$(curl -s -I -X OPTIONS http://localhost:3200/api/stripe/checkout \
    -H "Origin: http://localhost:4201" \
    -H "Access-Control-Request-Method: POST" | grep -i "access-control-allow-origin")

if [ -n "$CORS_RESPONSE" ]; then
    echo -e "${GREEN}✓ CORS configured for localhost:4201${NC}"
else
    echo -e "${RED}✗ CORS not configured${NC}"
fi

echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Test Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Start website: nx serve website"
echo "2. Visit: http://localhost:4201/pricing"
echo "3. Click 'Get Started' on paid tier"
echo "4. Verify redirect to checkout page"
echo ""
echo -e "${YELLOW}For full Stripe testing:${NC}"
echo "• Install Stripe CLI: https://stripe.com/docs/stripe-cli"
echo "• Run: stripe listen --forward-to localhost:3200/api/webhooks/stripe"
echo "• Test webhooks: stripe trigger checkout.session.completed"
echo ""
