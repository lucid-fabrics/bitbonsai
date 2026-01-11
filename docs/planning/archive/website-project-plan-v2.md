# BitBonsai Website + Admin Dashboard - Project Plan v2

**Project:** bitbonsai.io (Marketing Website + License Admin Dashboard)

**Tech:** NestJS monolith (extends `apps/license-api`)

**Goal:** Create an exciting marketing website that makes people want to pay before trying, plus an admin dashboard for managing licenses.

---

## 📦 Project Structure

```
bitbonsai/
├── apps/
│   ├── license-api/                    # NestJS monolith (API + Website + Admin)
│   │   ├── src/
│   │   │   ├── app/app.module.ts       # Main module (add website modules)
│   │   │   ├── main.ts                 # Bootstrap
│   │   │   │
│   │   │   ├── license/                # ✅ Existing - License CRUD + verify
│   │   │   ├── webhook/                # ✅ Existing - Patreon/Stripe/Ko-fi webhooks
│   │   │   ├── crypto/                 # ✅ Existing - License key signing
│   │   │   ├── email/                  # ✅ Existing - Email service
│   │   │   ├── prisma/                 # ✅ Existing - Database client
│   │   │   ├── guards/                 # ✅ Existing - AdminApiKeyGuard
│   │   │   │
│   │   │   ├── website/                # 🆕 Marketing pages (static HTML)
│   │   │   │   ├── website.module.ts
│   │   │   │   ├── website.controller.ts
│   │   │   │   └── templates/          # EJS/Handlebars templates
│   │   │   │       ├── home.ejs
│   │   │   │       ├── features.ejs
│   │   │   │       ├── pricing.ejs
│   │   │   │       ├── compare.ejs
│   │   │   │       ├── download.ejs
│   │   │   │       └── layouts/
│   │   │   │           └── main.ejs
│   │   │   │
│   │   │   ├── admin/                  # 🆕 Admin dashboard (server-rendered)
│   │   │   │   ├── admin.module.ts
│   │   │   │   ├── admin.controller.ts
│   │   │   │   ├── admin.service.ts
│   │   │   │   ├── guards/
│   │   │   │   │   └── session-auth.guard.ts
│   │   │   │   └── templates/
│   │   │   │       ├── login.ejs
│   │   │   │       ├── dashboard.ejs
│   │   │   │       ├── licenses.ejs
│   │   │   │       ├── users.ejs
│   │   │   │       ├── webhooks.ejs
│   │   │   │       └── layouts/
│   │   │   │           └── admin.ejs
│   │   │   │
│   │   │   ├── analytics/              # 🆕 Analytics endpoints for admin
│   │   │   │   ├── analytics.module.ts
│   │   │   │   ├── analytics.controller.ts
│   │   │   │   └── analytics.service.ts
│   │   │   │
│   │   │   └── patreon/                # 🆕 Patreon OAuth for users
│   │   │       ├── patreon.module.ts   # (migrate from backend)
│   │   │       ├── patreon.controller.ts
│   │   │       └── patreon.service.ts
│   │   │
│   │   ├── public/                     # Static assets
│   │   │   ├── css/
│   │   │   │   └── tailwind.css        # Compiled Tailwind
│   │   │   ├── js/
│   │   │   │   └── admin.js            # Admin dashboard JS (HTMX, Alpine.js)
│   │   │   ├── images/
│   │   │   │   ├── logo.svg
│   │   │   │   ├── screenshots/
│   │   │   │   └── icons/
│   │   │   └── videos/
│   │   │
│   │   ├── views/                      # EJS templates (symlink to src/*/templates)
│   │   ├── prisma/schema.prisma        # ✅ Existing - License database
│   │   └── tailwind.config.js          # 🆕 Tailwind configuration
│   │
│   ├── backend/                        # Existing BitBonsai backend
│   │   └── src/integrations/patreon/   # 🔄 TO MIGRATE → license-api
│   │
│   └── frontend/                       # Existing Angular frontend
│       └── src/app/settings/license/   # 🆕 Add license key input UI
│
└── libs/
    └── shared-types/                   # 🆕 Shared DTO interfaces (NOT Prisma models)
```

---

## 🎨 Tech Stack (NestJS-Based)

| Layer | Technology | Why |
|-------|-----------|-----|
| **Framework** | NestJS | Existing, server-rendered HTML, API in same app |
| **View Engine** | EJS (or Handlebars) | Simple templating, SSR for SEO |
| **Styling** | Tailwind CSS | Utility-first, compiled to static CSS |
| **Icons** | Font Awesome (CDN) | Rich icon library, easy CDN setup |
| **Admin UI** | HTMX + Alpine.js | Lightweight interactivity without React/Vue |
| **Forms** | Native HTML + NestJS validation | Type-safe with class-validator |
| **Auth** | express-session + Passport | Session-based admin auth |
| **API Client** | N/A (same server) | Admin uses server-side rendering |
| **Database** | PostgreSQL (via Prisma) | ✅ Already configured |

---

## 🌐 Marketing Website Structure

### **Routes (NestJS Controllers)**

| Route | Controller | View Template | Purpose |
|-------|-----------|---------------|---------|
| `GET /` | WebsiteController | `home.ejs` | Hero, pain points, features |
| `GET /features` | WebsiteController | `features.ejs` | Deep-dive features |
| `GET /pricing` | WebsiteController | `pricing.ejs` | Patreon tiers, Stripe plans |
| `GET /compare` | WebsiteController | `compare.ejs` | vs Tdarr/FileFlows |
| `GET /download` | WebsiteController | `download.ejs` | Docker/Unraid install |
| `GET /docs/*` | WebsiteController | `docs/*.ejs` | Static docs pages |

### **1. Home Page (`GET /`)**

**Controller:**
```typescript
@Controller()
export class WebsiteController {
  @Get()
  @Render('home')
  getHome() {
    return {
      title: 'BitBonsai - Trim your library. Not your quality.',
      stats: {
        dockerPulls: '10K+',
        githubStars: '500+',
        activeUsers: '2K+',
      },
    };
  }
}
```

**Template (`home.ejs`):**
```html
<!DOCTYPE html>
<html>
<head>
  <title><%= title %></title>
  <link href="/css/tailwind.css" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" rel="stylesheet">
</head>
<body>
  <!-- Hero Section -->
  <section class="bg-gray-900 text-white py-20">
    <h1 class="text-5xl font-bold">Trim your library. Not your quality.</h1>
    <p class="text-xl mt-4">40-60% storage savings. Zero friction.</p>
    <button class="mt-6 bg-green-500 px-8 py-3 rounded">Start in 5 Minutes</button>
  </section>

  <!-- Pain Points Grid -->
  <section class="py-16">
    <div class="grid grid-cols-3 gap-8">
      <div class="text-center">
        <i class="fas fa-exclamation-triangle fa-3x text-red-500"></i>
        <h3 class="mt-4">Crash at 98%?</h3>
        <p>TRUE RESUME picks up at 98%, not 0%.</p>
      </div>
      <!-- More pain points... -->
    </div>
  </section>

  <!-- Stats -->
  <section class="bg-gray-100 py-8">
    <div class="flex justify-around">
      <div><i class="fab fa-docker"></i> <%= stats.dockerPulls %> pulls</div>
      <div><i class="fab fa-github"></i> <%= stats.githubStars %> stars</div>
      <div><i class="fas fa-users"></i> <%= stats.activeUsers %> users</div>
    </div>
  </section>
</body>
</html>
```

---

### **2. Pricing Page (`GET /pricing`)**

**Controller:**
```typescript
@Get('pricing')
@Render('pricing')
async getPricing() {
  const tiers = [
    { name: 'FREE', price: '$0/mo', nodes: 1, jobs: 2 },
    { name: 'Supporter', price: '$3/mo', nodes: 2, jobs: 3 },
    { name: 'Plus', price: '$5/mo', nodes: 3, jobs: 5 },
    { name: 'Pro', price: '$10/mo', nodes: 5, jobs: 10 },
    { name: 'Ultimate', price: '$20/mo', nodes: 10, jobs: 20 },
  ];
  return { tiers };
}
```

**Template (`pricing.ejs`):**
```html
<div class="grid grid-cols-5 gap-4">
  <% tiers.forEach(tier => { %>
    <div class="border rounded p-6">
      <h3 class="text-2xl font-bold"><%= tier.name %></h3>
      <p class="text-3xl text-green-500"><%= tier.price %></p>
      <ul class="mt-4">
        <li><i class="fas fa-check text-green-500"></i> <%= tier.nodes %> nodes</li>
        <li><i class="fas fa-check text-green-500"></i> <%= tier.jobs %> concurrent jobs</li>
      </ul>
      <button class="mt-6 w-full bg-blue-500 text-white py-2 rounded">
        Get Started
      </button>
    </div>
  <% }); %>
</div>
```

---

## 🔐 Admin Dashboard Structure

### **Routes (Protected by Session Auth)**

| Route | Controller | Template | Purpose |
|-------|-----------|----------|---------|
| `GET /admin/login` | AdminController | `login.ejs` | Admin login form |
| `POST /admin/login` | AdminController | - | Process login, create session |
| `GET /admin/dashboard` | AdminController | `dashboard.ejs` | Metrics, charts |
| `GET /admin/licenses` | AdminController | `licenses.ejs` | License table (server-rendered) |
| `POST /admin/licenses` | AdminController | - | Create license (AJAX) |
| `GET /admin/webhooks` | AdminController | `webhooks.ejs` | Webhook events table |
| `GET /admin/analytics` | AnalyticsController | `analytics.ejs` | Charts, stats |

---

### **1. Login Page (`GET /admin/login`)**

**Controller:**
```typescript
@Controller('admin')
export class AdminController {
  @Get('login')
  @Render('admin/login')
  getLogin() {
    return { title: 'Admin Login' };
  }

  @Post('login')
  @UseGuards(LocalAuthGuard) // Passport local strategy
  async login(@Req() req, @Res() res) {
    req.session.isAdmin = true;
    res.redirect('/admin/dashboard');
  }
}
```

**Template (`admin/login.ejs`):**
```html
<div class="min-h-screen flex items-center justify-center bg-gray-900">
  <form method="POST" class="bg-white p-8 rounded shadow-lg">
    <h2 class="text-2xl font-bold mb-4">Admin Login</h2>
    <input type="password" name="apiKey" placeholder="API Key"
           class="w-full border px-4 py-2 rounded mb-4">
    <button type="submit" class="w-full bg-blue-500 text-white py-2 rounded">
      Login
    </button>
  </form>
</div>
```

**Auth Guard:**
```typescript
@Injectable()
export class SessionAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return request.session?.isAdmin === true;
  }
}
```

---

### **2. Dashboard Home (`GET /admin/dashboard`)**

**Controller:**
```typescript
@Get('dashboard')
@UseGuards(SessionAuthGuard)
@Render('admin/dashboard')
async getDashboard(@Inject(AnalyticsService) analytics) {
  const stats = await analytics.getStats();
  return {
    totalLicenses: stats.total,
    activeLicenses: stats.active,
    revenue: stats.monthlyRevenue,
    recentWebhooks: await this.webhookService.getRecent(10),
  };
}
```

**Template (`admin/dashboard.ejs`):**
```html
<div class="grid grid-cols-4 gap-4">
  <div class="bg-white p-6 rounded shadow">
    <i class="fas fa-key fa-2x text-blue-500"></i>
    <h3 class="mt-2 text-2xl font-bold"><%= totalLicenses %></h3>
    <p class="text-gray-600">Total Licenses</p>
  </div>
  <div class="bg-white p-6 rounded shadow">
    <i class="fas fa-check-circle fa-2x text-green-500"></i>
    <h3 class="mt-2 text-2xl font-bold"><%= activeLicenses %></h3>
    <p class="text-gray-600">Active</p>
  </div>
  <div class="bg-white p-6 rounded shadow">
    <i class="fas fa-dollar-sign fa-2x text-yellow-500"></i>
    <h3 class="mt-2 text-2xl font-bold">$<%= revenue %></h3>
    <p class="text-gray-600">MRR</p>
  </div>
</div>

<!-- Recent Webhooks -->
<div class="mt-8 bg-white p-6 rounded shadow">
  <h2 class="text-xl font-bold mb-4">Recent Webhooks</h2>
  <table class="w-full">
    <thead>
      <tr class="border-b">
        <th>Provider</th><th>Type</th><th>Status</th><th>Time</th>
      </tr>
    </thead>
    <tbody>
      <% recentWebhooks.forEach(webhook => { %>
        <tr class="border-b">
          <td><%= webhook.provider %></td>
          <td><%= webhook.eventType %></td>
          <td>
            <span class="badge <%= webhook.status === 'PROCESSED' ? 'bg-green-100' : 'bg-red-100' %>">
              <%= webhook.status %>
            </span>
          </td>
          <td><%= webhook.createdAt.toLocaleString() %></td>
        </tr>
      <% }); %>
    </tbody>
  </table>
</div>
```

---

### **3. Licenses Page (`GET /admin/licenses`)**

**Controller:**
```typescript
@Get('licenses')
@UseGuards(SessionAuthGuard)
@Render('admin/licenses')
async getLicenses(
  @Query('page') page = 1,
  @Query('tier') tier?: string,
  @Query('status') status?: string,
  @Query('search') search?: string,
) {
  const { licenses, total } = await this.licenseService.findAll({
    page: Number(page),
    limit: 50,
    tier,
    status,
    search,
  });

  return {
    licenses,
    total,
    page,
    tiers: Object.values(LicenseTier),
    statuses: Object.values(LicenseStatus),
  };
}
```

**Template (`admin/licenses.ejs`):**
```html
<!-- Filters -->
<div class="bg-white p-4 rounded shadow mb-4 flex gap-4">
  <select name="tier" hx-get="/admin/licenses" hx-target="#licenses-table">
    <option value="">All Tiers</option>
    <% tiers.forEach(tier => { %>
      <option value="<%= tier %>"><%= tier %></option>
    <% }); %>
  </select>
  <input type="text" name="search" placeholder="Search by email"
         hx-get="/admin/licenses" hx-trigger="keyup changed delay:500ms" hx-target="#licenses-table">
  <button class="bg-green-500 text-white px-4 py-2 rounded"
          hx-get="/admin/licenses/create-modal" hx-target="#modal">
    <i class="fas fa-plus"></i> Create License
  </button>
</div>

<!-- Table -->
<div id="licenses-table" class="bg-white p-6 rounded shadow">
  <table class="w-full">
    <thead>
      <tr class="border-b">
        <th>Email</th><th>Tier</th><th>Status</th><th>Nodes</th><th>Jobs</th><th>Expires</th><th>Actions</th>
      </tr>
    </thead>
    <tbody>
      <% licenses.forEach(license => { %>
        <tr class="border-b">
          <td><%= license.email %></td>
          <td>
            <span class="badge bg-blue-100"><%= license.tier %></span>
          </td>
          <td>
            <span class="badge <%= license.status === 'ACTIVE' ? 'bg-green-100' : 'bg-red-100' %>">
              <%= license.status %>
            </span>
          </td>
          <td><%= license.maxNodes %></td>
          <td><%= license.maxConcurrentJobs %></td>
          <td><%= license.expiresAt ? license.expiresAt.toLocaleDateString() : 'Never' %></td>
          <td>
            <button hx-get="/admin/licenses/<%= license.id %>/view" hx-target="#modal">
              <i class="fas fa-eye"></i>
            </button>
            <button hx-post="/admin/licenses/<%= license.id %>/revoke" hx-confirm="Revoke this license?">
              <i class="fas fa-ban text-red-500"></i>
            </button>
          </td>
        </tr>
      <% }); %>
    </tbody>
  </table>

  <!-- Pagination -->
  <div class="mt-4 flex justify-between">
    <span>Showing <%= licenses.length %> of <%= total %></span>
    <div>
      <% if (page > 1) { %>
        <button hx-get="/admin/licenses?page=<%= page - 1 %>" hx-target="#licenses-table">
          Previous
        </button>
      <% } %>
      <% if (licenses.length === 50) { %>
        <button hx-get="/admin/licenses?page=<%= page + 1 %>" hx-target="#licenses-table">
          Next
        </button>
      <% } %>
    </div>
  </div>
</div>

<!-- Modal Container -->
<div id="modal"></div>
```

**HTMX Benefits:**
- No page reload for filters/pagination
- Progressive enhancement (works without JS)
- Lightweight (~14KB)

---

## 🔌 License API Endpoints (Additions)

### **New Admin Endpoints**

| Endpoint | Method | Purpose | Returns |
|----------|--------|---------|---------|
| `GET /api/licenses` | GET | List all licenses (paginated) | `{ licenses, total }` |
| `GET /api/licenses/:id` | GET | Get single license + activations | `License & { activations[] }` |
| `PATCH /api/licenses/:id/extend` | PATCH | Update expiresAt | `License` |
| `GET /api/webhooks` | GET | List webhook events | `{ webhooks, total }` |
| `POST /api/webhooks/:id/retry` | POST | Retry failed webhook | `WebhookEvent` |
| `GET /api/analytics/stats` | GET | Dashboard stats | `{ total, active, revenue }` |
| `GET /api/analytics/growth` | GET | License growth chart data | `{ labels[], data[] }` |

### **User-Facing Endpoints (New)**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/patreon/auth` | GET | Get Patreon OAuth URL |
| `GET /api/patreon/callback` | GET | OAuth callback, activate license |
| `GET /api/user/license` | GET | Get current user's license (by session) |
| `POST /api/user/license/activate` | POST | Activate license on machine |

---

## 🚀 Deployment

### **Single NestJS App**

| Service | URL | Purpose |
|---------|-----|---------|
| **Production** | https://bitbonsai.io | Marketing + Admin + API |
| **API** | https://bitbonsai.io/api | REST API (existing) |
| **Admin** | https://bitbonsai.io/admin | Admin dashboard |
| **Docs** | https://bitbonsai.io/docs | Swagger API docs |

### **Environment Variables**

```bash
# Database
LICENSE_DATABASE_URL=postgresql://user:pass@host:5432/bitbonsai_licenses

# Admin Auth
ADMIN_API_KEY=supersecret123
SESSION_SECRET=random-session-secret

# Patreon OAuth
PATREON_CLIENT_ID=xxx
PATREON_CLIENT_SECRET=xxx
PATREON_WEBHOOK_SECRET=xxx
PATREON_REDIRECT_URI=https://bitbonsai.io/api/patreon/callback

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Ko-fi
KOFI_VERIFICATION_TOKEN=xxx

# Email (SendGrid, etc.)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=xxx
```

### **Docker Deployment**

```dockerfile
# Dockerfile (apps/license-api/Dockerfile)
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY dist/apps/license-api ./
COPY apps/license-api/public ./public
COPY apps/license-api/views ./views

CMD ["node", "main.js"]
```

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: bitbonsai_licenses
      POSTGRES_USER: bitbonsai
      POSTGRES_PASSWORD: changeme
    volumes:
      - postgres_data:/var/lib/postgresql/data

  license-api:
    build: ./apps/license-api
    ports:
      - "3200:3200"
    depends_on:
      - postgres
    environment:
      LICENSE_DATABASE_URL: postgresql://bitbonsai:changeme@postgres:5432/bitbonsai_licenses
      ADMIN_API_KEY: ${ADMIN_API_KEY}
      SESSION_SECRET: ${SESSION_SECRET}
    volumes:
      - ./apps/license-api/public:/app/public

volumes:
  postgres_data:
```

---

## 📝 Implementation Phases

### **Phase 1: Extend license-api with Marketing Pages** (Week 1)

- [ ] Install EJS view engine (`npm i @nestjs/platform-express ejs`)
- [ ] Install Tailwind CSS (`npm i -D tailwindcss`)
- [ ] Create `WebsiteModule` and `WebsiteController`
- [ ] Build templates: `home.ejs`, `features.ejs`, `pricing.ejs`
- [ ] Serve static files from `public/` (CSS, JS, images)
- [ ] Add Font Awesome via CDN
- [ ] Test routes: `/`, `/features`, `/pricing`, `/compare`, `/download`

### **Phase 2: Admin Dashboard - Auth + Home** (Week 2)

- [ ] Install session middleware (`npm i express-session @types/express-session`)
- [ ] Create `AdminModule` and `AdminController`
- [ ] Implement `SessionAuthGuard`
- [ ] Build login page (`admin/login.ejs`)
- [ ] Build dashboard home (`admin/dashboard.ejs`) with stats
- [ ] Create `AnalyticsService` for stats aggregation

### **Phase 3: Admin Dashboard - CRUD Pages** (Week 3)

- [ ] Add HTMX (`<script src="https://unpkg.com/htmx.org@1.9.10">`)
- [ ] Build Licenses page (`admin/licenses.ejs`) with filters, pagination
- [ ] Add endpoints: `GET /api/licenses`, `PATCH /api/licenses/:id/extend`
- [ ] Build Users page (`admin/users.ejs`) - aggregated view
- [ ] Build Webhooks page (`admin/webhooks.ejs`)
- [ ] Add webhook retry endpoint: `POST /api/webhooks/:id/retry`

### **Phase 4: Patreon OAuth + User License Page** (Week 4)

- [ ] Migrate Patreon integration from `backend` to `license-api`
- [ ] Create `PatreonModule` with OAuth flow
- [ ] Add user-facing route: `GET /license` (view your license)
- [ ] "Connect Patreon" button → OAuth flow → activate license
- [ ] Store Patreon user session (separate from admin)

### **Phase 5: Polish + Deploy** (Week 5)

- [ ] Add screenshots/videos to marketing pages
- [ ] SEO: meta tags, sitemap, Open Graph images
- [ ] Mobile responsive (Tailwind breakpoints)
- [ ] Dark mode toggle (Tailwind dark: variants)
- [ ] Performance: image optimization, lazy loading
- [ ] Deploy to production (Docker + Traefik/Nginx)
- [ ] DNS: bitbonsai.io → server IP

### **Phase 6: Enhancements** (Future)

- [ ] Analytics page with charts (Recharts or Chart.js)
- [ ] Email notifications (license activated, expiring, revoked)
- [ ] License expiration cron job
- [ ] Rate limiting (NestJS Throttler)
- [ ] Changelog/blog (MDX via Markdown module)

---

## 🎯 Key Differences from Next.js Plan

| Aspect | Next.js Plan | NestJS Plan |
|--------|-------------|-------------|
| **Framework** | Next.js 14 (React) | NestJS (Server-rendered) |
| **Rendering** | SSR + Client-side | Pure SSR (EJS templates) |
| **API Client** | Axios (cross-origin) | Same server (no client) |
| **Auth** | NextAuth.js | express-session + Passport |
| **Interactivity** | React components | HTMX + Alpine.js |
| **Build Output** | Static + Lambda | Single Node.js process |
| **Deployment** | Vercel | Docker / VPS |
| **Complexity** | Higher (separate frontend) | Lower (monolith) |
| **SEO** | Excellent (SSR) | Excellent (SSR) |
| **Performance** | Fast (CDN) | Fast (single server) |

---

## 🔧 Migration from Backend

### **Move Patreon Integration**

**From:** `apps/backend/src/integrations/patreon/`
**To:** `apps/license-api/src/patreon/`

**Steps:**
1. Copy files: `patreon.service.ts`, `patreon.controller.ts`, `patreon.module.ts`
2. Update imports: `@prisma/client` → `.prisma/license-client`
3. Update `License` model usage (different schema)
4. Remove from backend, add import to `license-api/app.module.ts`

**Backend becomes consumer:**
```typescript
// apps/backend/src/license/license.service.ts
async verifyLicense(key: string): Promise<LicenseInfo> {
  const response = await this.httpService.post(
    'https://bitbonsai.io/api/licenses/verify',
    { licenseKey: key }
  );
  return response.data.license;
}
```

---

## ✅ Advantages of NestJS Approach

1. **Single Codebase** - Marketing + Admin + API in one app
2. **No CORS Issues** - Everything same-origin
3. **Simpler Auth** - Sessions, no JWT/API key exposure
4. **Lower Hosting Cost** - One VPS vs Vercel + API server
5. **Easier Development** - No separate frontend build
6. **Type Safety** - TypeScript everywhere, shared DTOs
7. **Faster Responses** - No network hop (frontend → API)
8. **SSR SEO** - Perfect for marketing pages
9. **Progressive Enhancement** - HTMX works without JS
10. **Familiar Stack** - Team already knows NestJS

---

## 📦 Deliverables

| Component | Path | Description |
|-----------|------|-------------|
| Marketing Website | `apps/license-api/src/website/` | Home, Features, Pricing, etc. |
| Admin Dashboard | `apps/license-api/src/admin/` | License management UI |
| Templates | `apps/license-api/views/` | EJS templates |
| Static Assets | `apps/license-api/public/` | CSS, JS, images, videos |
| API Extensions | `apps/license-api/src/license/`, `analytics/` | New endpoints |
| Shared Types | `libs/shared-types/` | DTOs (optional, can use class-validator) |

---

**Next Steps:**
1. Review NestJS-based plan
2. Approve tech stack (EJS, HTMX, Tailwind)
3. Start Phase 1 (Marketing pages)
4. Plan screenshot/video production
