# BitBonsai Website

> **Static marketing website for bitbonsai.io**

Angular standalone application serving as the public-facing marketing site for BitBonsai.

---

## Overview

| Property | Value |
|----------|-------|
| **Type** | Static Angular website |
| **Framework** | Angular 20 (standalone) |
| **Domain** | bitbonsai.io |
| **Port (dev)** | 4201 |
| **Deploy** | Static files (Netlify/Vercel/S3) |

---

## Architecture

```
apps/website/
├── src/
│   ├── app/
│   │   ├── pages/
│   │   │   ├── home/              # Landing page
│   │   │   ├── pricing/           # Pricing & tiers (API integration)
│   │   │   ├── features/          # Feature showcase
│   │   │   ├── about/             # About us
│   │   │   └── contact/           # Contact form
│   │   ├── components/
│   │   │   ├── header/            # Navigation
│   │   │   ├── footer/            # Footer
│   │   │   └── shared/            # Reusable components
│   │   ├── services/
│   │   │   └── pricing-api.service.ts  # License-API integration
│   │   └── app.routes.ts          # Route configuration
│   ├── assets/
│   │   ├── images/                # Screenshots, logos
│   │   └── docs/                  # Static docs
│   ├── environments/
│   │   ├── environment.ts         # Dev config
│   │   └── environment.prod.ts    # Prod config
│   └── styles.scss                # Global styles
├── public/
│   ├── favicon.ico
│   ├── favicon.svg
│   └── robots.txt
└── project.json                   # Nx build config
```

---

## API Integration

### License-API Connection

Website fetches live pricing data from license-api:

| Environment | API URL |
|-------------|---------|
| **Dev** | http://localhost:3200/api |
| **Prod** | https://api.bitbonsai.io/api |

**Key Endpoint:**
```typescript
GET /api/pricing
```

**Service:** `apps/website/src/app/services/pricing-api.service.ts`

**Usage:**
```typescript
import { PricingApiService } from '@services/pricing-api.service';

export class PricingComponent {
  tiers$ = this.pricingApi.getActiveTiers();

  constructor(private pricingApi: PricingApiService) {}
}
```

**Response:**
```typescript
interface PricingTier {
  id: string;
  name: string;              // "FREE" | "SUPPORTER" | etc.
  displayName: string;       // "Free" | "Supporter"
  description?: string;
  maxNodes: number;
  maxConcurrentJobs: number;
  priceMonthly: number;      // cents (500 = $5.00)
  priceYearly?: number;      // cents
  stripePriceIdMonthly?: string;
  stripePriceIdYearly?: string;
  patreonTierId?: string;
  isActive: boolean;
}
```

**Error Handling:**
- Loading spinner while fetching
- User-friendly errors (connection, rate limit, server error)
- No fallback data (real-time pricing only)

---

## Development

### Start Dev Server

```bash
# Serve website (port 4201)
nx serve website

# Watch mode with live reload
nx serve website --open
```

**Access:** http://localhost:4201

### Environment Setup

Create `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3200/api',
  licenseApiUrl: 'http://localhost:3200/api'
};
```

### Build

```bash
# Development build
nx build website

# Production build (optimized, minified)
nx build website --configuration=production

# Output: dist/apps/website
```

---

## Deployment

### Static Hosting

Website is a static Angular app (no backend) deployed to:

| Platform | Use Case | Deploy Method |
|----------|----------|---------------|
| **Netlify** | Recommended | Drag & drop `dist/apps/website` |
| **Vercel** | Alternative | CLI or GitHub integration |
| **AWS S3 + CloudFront** | Enterprise | Terraform/manual upload |
| **GitHub Pages** | Free tier | GitHub Actions workflow |

### Build for Production

```bash
# Clean build
nx reset
nx build website --configuration=production

# Output: dist/apps/website
# Deploy this folder to hosting platform
```

### Environment Variables

Set in hosting platform:

| Variable | Dev | Prod |
|----------|-----|------|
| `API_URL` | http://localhost:3200/api | https://api.bitbonsai.io/api |

**Netlify/Vercel:**
- Build command: `npx nx build website --configuration=production`
- Publish directory: `dist/apps/website`

---

## Pages

### Home (`/`)

**Components:**
- Hero section (CTA buttons)
- Feature highlights (cards)
- Screenshots/demo video
- Testimonials
- Pricing preview
- Footer CTA

**Key Features:**
- Responsive design (mobile-first)
- Scroll animations
- Video background
- Newsletter signup

### Pricing (`/pricing`)

**Dynamic Pricing Table:**
- Fetches live data from license-api
- Monthly/yearly toggle
- Feature comparison matrix
- CTA buttons (Patreon/Stripe)

**Component:** `apps/website/src/app/pages/pricing/pricing.component.ts`

**Template:**
```html
<div class="pricing-tiers">
  @for (tier of tiers$ | async; track tier.id) {
    <div class="tier-card" [class.featured]="tier.name === 'SUPPORTER'">
      <h3>{{ tier.displayName }}</h3>
      <p class="price">${{ tier.priceMonthly / 100 }}/mo</p>
      <ul class="features">
        <li>{{ tier.maxNodes }} nodes</li>
        <li>{{ tier.maxConcurrentJobs }} concurrent jobs</li>
      </ul>
      <button>Get Started</button>
    </div>
  }
</div>
```

### Features (`/features`)

**Sections:**
- TRUE RESUME (crash recovery)
- Multi-node distributed encoding
- Auto-heal system
- Hardware acceleration
- Policy engine
- Real-time progress

### About (`/about`)

**Content:**
- Team
- Mission statement
- Roadmap
- Open source philosophy

### Contact (`/contact`)

**Form fields:**
- Name, email, subject, message
- Sends to support email via backend API

---

## Styling

### Tailwind CSS

**Config:** `tailwind.config.js`

**Custom theme:**
```typescript
theme: {
  extend: {
    colors: {
      primary: '#3b82f6',    // Blue
      secondary: '#10b981',  // Green
      accent: '#f59e0b'      // Orange
    }
  }
}
```

**Usage:**
```html
<button class="bg-primary text-white px-6 py-3 rounded-lg hover:bg-primary/90">
  Get Started
</button>
```

### Global Styles

**File:** `src/styles.scss`

```scss
@import 'tailwindcss/base';
@import 'tailwindcss/components';
@import 'tailwindcss/utilities';

// Custom global styles
body {
  @apply bg-gray-50 text-gray-900;
}

h1, h2, h3 {
  @apply font-bold;
}
```

---

## Assets

### Favicon

**Location:** `apps/website/public/`

**Files:**
- `favicon.ico` (legacy)
- `favicon.svg` (modern browsers)
- `apple-touch-icon.png` (180x180)
- `favicon-16x16.png`
- `favicon-32x32.png`

**Generate favicons:**
```bash
# From SVG source
convert favicon.svg -resize 32x32 favicon-32x32.png
convert favicon.svg -resize 16x16 favicon-16x16.png
```

### Images

**Location:** `apps/website/src/assets/images/`

**Naming convention:**
- `screenshot-{feature}.png` (e.g., `screenshot-queue.png`)
- `logo-{variant}.svg` (e.g., `logo-dark.svg`, `logo-light.svg`)
- `hero-background.jpg`

**Optimization:**
- Use WebP for photos
- SVG for icons/logos
- Lazy loading: `<img loading="lazy">`

---

## SEO

### Meta Tags

**Location:** `apps/website/src/index.html`

```html
<head>
  <title>BitBonsai - Professional Media Automation</title>
  <meta name="description" content="Distributed video transcoding platform with TRUE RESUME crash recovery">
  <meta name="keywords" content="video encoding, HEVC, AV1, transcoding, media automation">

  <!-- Open Graph -->
  <meta property="og:title" content="BitBonsai - Media Automation">
  <meta property="og:description" content="Professional video transcoding platform">
  <meta property="og:image" content="https://bitbonsai.io/og-image.png">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="BitBonsai">
</head>
```

### robots.txt

**Location:** `apps/website/public/robots.txt`

```
User-agent: *
Allow: /

Sitemap: https://bitbonsai.io/sitemap.xml
```

### sitemap.xml

**Generate:**
```bash
# Manual or use Angular Universal
ng add @ng-toolkit/universal
```

---

## Analytics

### Google Analytics 4

**Setup:**
```html
<!-- src/index.html -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

### Plausible (Privacy-friendly alternative)

```html
<script defer data-domain="bitbonsai.io" src="https://plausible.io/js/script.js"></script>
```

---

## Testing

### Unit Tests

```bash
# Run tests
nx test website

# Watch mode
nx test website --watch

# Coverage
nx test website --coverage
```

### E2E Tests

```bash
# Playwright tests
nx e2e website-e2e

# Specific test
nx e2e website-e2e --spec="pricing.spec.ts"
```

**Test file:** `apps/website-e2e/src/pricing.spec.ts`

```typescript
test('should load pricing tiers from API', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.locator('.tier-card')).toHaveCount(4); // FREE, SUPPORTER, PRO, ENTERPRISE
  await expect(page.locator('text=Free')).toBeVisible();
});
```

---

## Troubleshooting

### API Connection Errors

**Symptom:** "Failed to load pricing data"

**Fix:**
1. Check license-api is running: `nx serve license-api`
2. Verify API URL in `environment.ts`
3. Check CORS settings in license-api

### Build Failures

**Symptom:** `nx build website` fails

**Fix:**
```bash
# Clear cache
nx reset

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild
nx build website
```

### Favicon Not Showing

**Symptom:** Browser shows default favicon

**Fix:**
1. Verify `public/favicon.ico` exists
2. Clear browser cache (Ctrl+Shift+R)
3. Check `index.html` links:
   ```html
   <link rel="icon" type="image/x-icon" href="favicon.ico">
   <link rel="icon" type="image/svg+xml" href="favicon.svg">
   ```

---

## Contributing

### Code Style

Follow project conventions:
- Components: PascalCase (`PricingComponent`)
- Services: camelCase with `.service.ts` suffix
- Use standalone components (no NgModules)
- Signals for reactive state

### Commit Messages

```
feat(website): add testimonials section
fix(website): pricing API error handling
docs(website): update deployment guide
```

---

## Related Documentation

- [License-API Integration](../license-api/README.md)
- [Main Project README](../../README.md)
- [CLAUDE.md - Website Section](../../CLAUDE.md#api-integration-website--license-api)

---

<div align="center">

**Marketing website for BitBonsai**

[Live Site](https://bitbonsai.io) • [Docs Home](../../docs/README.md) • [License-API](../license-api/README.md)

</div>
