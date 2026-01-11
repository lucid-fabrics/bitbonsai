# BitBonsai Website + Admin Dashboard - Project Plan

**Project:** bitbonsai.io (Marketing Website + License Admin Dashboard)

**Goal:** Create an exciting marketing website that makes people want to pay before trying, plus an admin dashboard for managing licenses.

---

## 📦 Project Structure

```
bitbonsai/
├── apps/
│   ├── website/                    # Next.js marketing site (bitbonsai.io)
│   │   ├── src/
│   │   │   ├── app/                # App router
│   │   │   │   ├── (marketing)/    # Public marketing pages
│   │   │   │   │   ├── page.tsx    # Home/Hero
│   │   │   │   │   ├── features/   # Feature deep-dives
│   │   │   │   │   ├── pricing/    # Pricing tiers
│   │   │   │   │   ├── compare/    # vs Tdarr/FileFlows
│   │   │   │   │   ├── docs/       # Public docs (setup, guides)
│   │   │   │   │   └── download/   # Download/install page
│   │   │   │   └── (admin)/        # Protected admin routes
│   │   │   │       ├── login/      # Admin login
│   │   │   │       └── dashboard/  # License management
│   │   │   │           ├── licenses/
│   │   │   │           ├── users/
│   │   │   │           ├── webhooks/
│   │   │   │           └── analytics/
│   │   │   ├── components/
│   │   │   │   ├── marketing/      # Hero, FeatureGrid, PricingCard, etc.
│   │   │   │   └── admin/          # LicenseTable, UserTable, etc.
│   │   │   ├── lib/
│   │   │   │   └── api-client.ts   # license-api client
│   │   │   └── styles/
│   │   │       └── globals.css     # Tailwind + FontAwesome
│   │   └── public/
│   │       ├── images/             # Screenshots, logos, icons
│   │       └── videos/             # Demo videos, feature spotlights
│   ├── license-api/                # Existing NestJS API (unchanged)
│   └── backend/                    # Existing BitBonsai backend
├── libs/
│   └── shared-types/               # Shared TypeScript types (License, Tier, etc.)
└── website-features.md             # Marketing content reference
```

---

## 🎨 Website Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Framework** | Next.js 14 (App Router) | SSR for SEO, fast page loads, easy deployment |
| **Styling** | Tailwind CSS | Rapid UI development, consistent design system |
| **Icons** | Font Awesome (Free) | Rich icon library for features, UI elements |
| **Components** | shadcn/ui | Beautiful, accessible components (tables, dialogs, forms) |
| **Animations** | Framer Motion | Smooth transitions, hero animations |
| **Forms** | React Hook Form + Zod | Type-safe admin forms, validation |
| **State** | Zustand | Lightweight state for admin dashboard |
| **API Client** | Axios | license-api integration |
| **Auth** | NextAuth.js | Admin authentication (API key or OAuth) |

---

## 🌐 Marketing Website Structure

### **1. Home Page (Hero Section)**

**Above the fold:**
- **Hero**: "Trim your library. Not your quality." + animated demo
- **Visual**: Multi-node encoding dashboard (5 nodes, live progress bars)
- **CTA**: "Start Encoding in 5 Minutes" + "See Live Demo"
- **Social Proof**: Docker Hub pulls, GitHub stars, community size

**Below the fold:**
- **Problem/Solution Grid**: 7 pain points → solutions (with icons)
- **Key Metrics**: 40-60% storage savings, 10-100x faster with SSD
- **Feature Highlights**: TRUE RESUME, Auto-Healing, Multi-Node, Zero Config
- **Testimonials** (future): User quotes with storage savings

**Tech:**
- Framer Motion for scroll animations
- Video background or animated SVG for hero
- FontAwesome icons for pain points

---

### **2. Features Page**

**Deep-dive sections:**
- **TRUE RESUME™**: Progress saved every 10s, exact timestamp recovery
- **Auto-Healing System**: 4-layer recovery flowchart
- **Multi-Node Distribution**: 11-factor scoring algorithm visualization
- **Encoding Intelligence**: Codec detection, hardware acceleration, container checks
- **Integrations**: Jellyfin, Plex, qBittorrent, Radarr/Sonarr cards

**Tech:**
- Interactive demos (hover effects, expand/collapse)
- Code snippets showing FFmpeg commands generated
- Comparison tables (BitBonsai vs competitors)

---

### **3. Pricing Page**

**Patreon Tiers (Community Support):**

| Tier | Price | Max Nodes | Concurrent Jobs | Features |
|------|-------|-----------|-----------------|----------|
| **FREE** | $0/mo | 1 | 2 | Perfect for testing, small libraries |
| **Supporter** | $3/mo | 2 | 3 | Home users, 1-2 servers |
| **Plus** | $5/mo | 3 | 5 | Homelab enthusiasts |
| **Pro** | $10/mo | 5 | 10 | Power users, multi-server |
| **Ultimate** | $20/mo | 10 | 20 | Data hoarders, massive libraries |

**Commercial Tiers (Stripe - Coming Soon):**
- Starter, Pro, Enterprise
- "Contact Sales" CTA for Enterprise

**Tech:**
- Pricing cards with hover effects
- Feature comparison matrix
- Toggle: Monthly / Yearly (with discount badge)
- FontAwesome checkmarks for features

---

### **4. Compare Page (vs Tdarr/FileFlows)**

**Side-by-side comparison:**

| Feature | BitBonsai | Tdarr | FileFlows |
|---------|-----------|-------|-----------|
| Setup Time | 5 min | 3+ days | 2+ days |
| Plugin Hell | ❌ Zero plugins | ✅ 47+ plugins | ✅ 20+ plugins |
| Resume After Crash | ✅ Exact timestamp | ❌ Restart from 0% | ❌ Restart from 0% |
| Auto-Healing | ✅ 4-layer | ❌ Manual retry | ❌ Manual retry |
| Multi-Node | ✅ Distributed | ❌ Single machine | ⚠️ Limited |
| UI/UX | ✅ Clean, intuitive | ❌ Complex | ⚠️ Moderate |

**Tech:**
- Sticky header table (scroll to see all features)
- FontAwesome icons for checkmarks/crosses
- Screenshot comparisons (UI side-by-side)

---

### **5. Download Page**

**Installation methods:**
- Docker Compose (recommended)
- Unraid Community Apps
- Kubernetes Helm chart
- Bare metal (systemd)

**Quick start:**
```yaml
docker-compose.yml preview
Quick setup instructions (3 steps)
```

**Tech:**
- Code blocks with copy button
- Platform selector tabs (Docker, Unraid, K8s)
- FontAwesome icons for platforms

---

### **6. Docs Pages (Public)**

**Getting Started:**
- Installation
- First library setup
- First encoding job
- Adding nodes

**Guides:**
- Multi-node setup (NFS vs SSH)
- Hardware acceleration (NVIDIA, Intel, AMD)
- Jellyfin/Plex integration
- Custom policies

**Tech:**
- Markdown-based (MDX)
- Syntax highlighting (Prism.js)
- Search (Algolia or local)

---

## 🔐 Admin Dashboard Structure

**Purpose:** Manage licenses created via Patreon/Stripe/Ko-fi webhooks + manual admin creation.

### **1. Login Page**

**Auth methods:**
- API Key login (AdminApiKeyGuard from license-api)
- OAuth (future: Google/GitHub for multi-admin)

**Tech:**
- NextAuth.js with Credentials provider
- Stores API key in secure HTTP-only cookie

---

### **2. Dashboard Home**

**Metrics:**
- Total licenses (by tier)
- Active vs expired vs revoked
- Revenue projections (based on tier prices)
- Recent webhook events (success/failure)

**Widgets:**
- License growth chart (by tier over time)
- Webhook status (pending/processed/failed)
- Top users by node count

**Tech:**
- Recharts for graphs
- shadcn/ui cards, badges
- FontAwesome icons for metrics

---

### **3. Licenses Page**

**Table columns:**
- Email
- Tier (badge with color)
- Status (ACTIVE, EXPIRED, REVOKED)
- Max Nodes / Concurrent Jobs
- Provider (MANUAL, PATREON, STRIPE, KOFI)
- Created / Expires
- Actions (View, Revoke, Extend)

**Filters:**
- Tier (dropdown)
- Status (dropdown)
- Provider (dropdown)
- Search by email

**Actions:**
- **Create License** (manual): Opens dialog with form
- **Revoke License**: Opens dialog with reason field
- **Extend Expiration**: Updates expiresAt date
- **View Details**: Shows full license info + activations

**Tech:**
- shadcn/ui Table (DataTable pattern)
- React Hook Form for create/revoke dialogs
- Axios calls to license-api
- FontAwesome icons for actions (edit, trash, eye)

---

### **4. Users Page**

**Aggregates licenses by email:**
- Email
- Total licenses (count)
- Highest tier
- Total activations
- Last seen (most recent activation)
- Actions (View All Licenses)

**Tech:**
- Derive from licenses table (group by email)
- Filter/search by email
- Link to Licenses page with email pre-filtered

---

### **5. Webhooks Page**

**Table columns:**
- Provider (PATREON, STRIPE, KOFI)
- Event Type (SUBSCRIPTION_CREATED, UPDATED, CANCELLED)
- Status (PENDING, PROCESSED, FAILED)
- Created / Processed At
- Error (if failed)
- Actions (View Payload, Retry)

**Filters:**
- Provider
- Status
- Date range

**Actions:**
- **View Payload**: Shows raw JSON in dialog
- **Retry Failed**: Re-process failed webhook

**Tech:**
- shadcn/ui Table
- JSON viewer component (react-json-view)
- Badge colors for status (green/yellow/red)

---

### **6. Analytics Page (Future)**

**Metrics:**
- License churn rate (cancellations vs new)
- Revenue by tier (MRR, ARR)
- Conversion funnel (free → paid)
- Geographic distribution (if IP tracked)

**Tech:**
- Recharts for graphs
- Date range picker

---

## 🎨 Design System (Tailwind + FontAwesome)

### **Color Palette**

| Color | Hex | Use |
|-------|-----|-----|
| **Primary** (Green) | #10B981 | CTAs, success states, links |
| **Secondary** (Blue) | #3B82F6 | Highlights, badges |
| **Accent** (Purple) | #8B5CF6 | Premium features, Ultimate tier |
| **Neutral** (Gray) | #6B7280 | Text, borders |
| **Danger** (Red) | #EF4444 | Errors, revoked status |
| **Warning** (Yellow) | #F59E0B | Warnings, CORRUPTED status |
| **Dark BG** | #111827 | Hero background, dark mode |

### **FontAwesome Icons (Free)**

| Icon | Use Case |
|------|----------|
| `fa-check-circle` | Feature checkmarks, success |
| `fa-times-circle` | Competitor lacks, errors |
| `fa-rocket` | Speed/performance features |
| `fa-shield-alt` | Auto-healing, reliability |
| `fa-server` | Multi-node, nodes |
| `fa-film` | Video encoding, media |
| `fa-bolt` | Fast encoding, hardware accel |
| `fa-magic` | Smart defaults, intelligence |
| `fa-sync` | TRUE RESUME, recovery |
| `fa-chart-line` | Analytics, metrics |
| `fa-users` | Users, community |
| `fa-cog` | Settings, configuration |
| `fa-lock` | Security, admin auth |
| `fa-envelope` | Email, notifications |
| `fa-crown` | Premium tiers, Ultimate |

---

## 🔌 License API Integration

### **Admin Endpoints Used**

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `POST /licenses` | POST | Create manual license | AdminApiKeyGuard |
| `GET /licenses/email/:email` | GET | Find licenses by email | AdminApiKeyGuard |
| `POST /licenses/:id/revoke` | POST | Revoke license with reason | AdminApiKeyGuard |
| `POST /licenses/verify` | POST | Verify license (public) | None |

### **Admin Endpoints to Add**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /licenses` | GET | List all licenses (paginated, filtered) |
| `GET /licenses/:id` | GET | Get single license details + activations |
| `PATCH /licenses/:id/extend` | PATCH | Update expiresAt |
| `GET /webhooks` | GET | List webhook events (paginated, filtered) |
| `POST /webhooks/:id/retry` | POST | Retry failed webhook |
| `GET /analytics/stats` | GET | Aggregate stats for dashboard |

### **API Client (`lib/api-client.ts`)**

```typescript
import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_LICENSE_API_URL,
  headers: {
    'x-api-key': process.env.LICENSE_ADMIN_API_KEY, // Server-side only
  },
});

export default apiClient;
```

---

## 📂 Nx Workspace Integration

### **Create Website App**

```bash
nx g @nx/next:app website --style=css --appDir=true
```

### **Shared Library for Types**

```bash
nx g @nx/js:lib shared-types
```

**Contents:**
- `LicenseTier` enum
- `LicenseStatus` enum
- `PaymentProvider` enum
- `License` interface
- `WebhookEvent` interface

**Usage:**
- Import in `license-api` (replace Prisma types in DTOs)
- Import in `website` (type-safe API client)

---

## 🚀 Deployment

### **Marketing Website (Vercel)**

| Service | URL | Purpose |
|---------|-----|---------|
| **Production** | https://bitbonsai.io | Marketing + Admin |
| **Preview** | https://bitbonsai-preview.vercel.app | PR previews |

**Environment Variables:**
- `NEXT_PUBLIC_LICENSE_API_URL` → https://license-api.bitbonsai.io
- `LICENSE_ADMIN_API_KEY` → Secret API key for admin routes
- `NEXTAUTH_SECRET` → NextAuth.js secret

### **License API (Existing Deployment)**

| Service | URL | Purpose |
|---------|-----|---------|
| **Production** | https://license-api.bitbonsai.io | License verification, webhooks |

**Environment Variables:**
- `LICENSE_DATABASE_URL` → PostgreSQL connection string
- `ADMIN_API_KEY` → Admin API key (matches website)
- `PATREON_WEBHOOK_SECRET` → Patreon webhook signature verification
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` → Stripe integration
- `KOFI_VERIFICATION_TOKEN` → Ko-fi webhook verification

---

## 📝 Todo: Implementation Phases

### **Phase 1: Setup + Marketing Home** (Week 1)

- [ ] Create `apps/website` with Next.js 14 (App Router)
- [ ] Install dependencies: Tailwind, FontAwesome, Framer Motion
- [ ] Create shared types library (`libs/shared-types`)
- [ ] Build Hero section (animated multi-node demo)
- [ ] Build Problem/Solution grid (7 pain points with icons)
- [ ] Build Feature highlights cards (TRUE RESUME, Auto-Healing, etc.)
- [ ] Add CTA buttons (Start in 5 min, See Demo)

### **Phase 2: Marketing Pages** (Week 2)

- [ ] Features page (deep-dive sections with animations)
- [ ] Pricing page (tier cards, monthly/yearly toggle)
- [ ] Compare page (vs Tdarr/FileFlows table)
- [ ] Download page (Docker/Unraid/K8s install tabs)
- [ ] Docs pages (Getting Started, Guides)

### **Phase 3: Admin Dashboard - Auth + Home** (Week 3)

- [ ] Add admin endpoints to license-api (GET /licenses, etc.)
- [ ] Setup NextAuth.js with API key provider
- [ ] Create admin login page
- [ ] Create admin dashboard home (metrics, charts)
- [ ] API client with auth middleware

### **Phase 4: Admin Dashboard - CRUD** (Week 4)

- [ ] Licenses page (table, filters, create/revoke/extend)
- [ ] Users page (aggregated by email)
- [ ] Webhooks page (list, view payload, retry)
- [ ] License details modal (activations, history)

### **Phase 5: Polish + Deploy** (Week 5)

- [ ] Screenshots/videos for marketing pages
- [ ] SEO optimization (meta tags, sitemap, Open Graph)
- [ ] Mobile responsive (all pages)
- [ ] Dark mode toggle
- [ ] Performance optimization (image optimization, lazy loading)
- [ ] Deploy to Vercel (marketing + admin)
- [ ] DNS setup (bitbonsai.io → Vercel)

### **Phase 6: Analytics + Enhancements** (Future)

- [ ] Analytics page (revenue, churn, conversion funnel)
- [ ] Email notifications (daily digest for admin)
- [ ] Testimonials section (collect user feedback)
- [ ] Interactive demo (embedded sandbox)
- [ ] Blog/changelog (MDX-based)

---

## 🎯 Success Metrics

**Marketing Website:**
- **Conversion Rate**: Visitors → Download/Install
- **Engagement**: Time on site, pages per session
- **SEO**: Rank for "video transcoding", "Tdarr alternative", "HEVC encoder"
- **Social Proof**: GitHub stars, Docker Hub pulls, Discord members

**Admin Dashboard:**
- **Efficiency**: Avg time to create/revoke license (< 30s)
- **Visibility**: Real-time webhook status, license health
- **Automation**: Webhook success rate (> 95%)

---

## 📦 Deliverables Summary

| Deliverable | Description | File/Path |
|-------------|-------------|-----------|
| **Marketing Website** | Next.js app with Hero, Features, Pricing, Compare, Docs | `apps/website/(marketing)/` |
| **Admin Dashboard** | Protected admin routes for license management | `apps/website/(admin)/` |
| **API Client** | Axios wrapper for license-api integration | `apps/website/src/lib/api-client.ts` |
| **Shared Types** | TypeScript types for License, Tier, etc. | `libs/shared-types/` |
| **Design System** | Tailwind config + FontAwesome icons | `apps/website/tailwind.config.js` |
| **License API Updates** | New admin endpoints (GET /licenses, etc.) | `apps/license-api/src/license/` |
| **Deployment Config** | Vercel setup for website | `apps/website/vercel.json` |

---

**End of Project Plan**

Next steps:
1. Review plan with stakeholder
2. Approve tech stack + structure
3. Start Phase 1 (Setup + Marketing Home)
4. Plan screenshot/video production for marketing content
