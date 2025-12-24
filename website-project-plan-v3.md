# BitBonsai Website + Admin Dashboard - Project Plan v3 (FINAL)

**Project:** bitbonsai.io (Marketing Website + License Admin Dashboard)

**Tech:** Nx monorepo with Angular 21+ (marketing) + NestJS (license-api backend)

**Code Conventions:** `~/git/code-conventions` (NgRx, BOs, Signals, 100% test coverage)

**Goal:** Create an exciting marketing website that makes people want to pay before trying, plus an admin dashboard for managing licenses.

---

## 📦 Nx Workspace Structure

```
bitbonsai/
├── apps/
│   ├── website/                        # 🆕 Angular 21+ marketing site
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── features/
│   │   │   │   │   ├── home/           # Landing page
│   │   │   │   │   │   ├── home.page.ts
│   │   │   │   │   │   ├── home.page.html
│   │   │   │   │   │   ├── home.page.scss
│   │   │   │   │   │   └── home.bo.ts
│   │   │   │   │   ├── features/       # Feature deep-dives
│   │   │   │   │   ├── pricing/        # Pricing tiers
│   │   │   │   │   ├── compare/        # vs Tdarr/FileFlows
│   │   │   │   │   ├── download/       # Install instructions
│   │   │   │   │   └── docs/           # Documentation
│   │   │   │   ├── shared/
│   │   │   │   │   └── components/
│   │   │   │   │       ├── hero/
│   │   │   │   │       ├── feature-card/
│   │   │   │   │       ├── pricing-card/
│   │   │   │   │       └── comparison-table/
│   │   │   │   └── app.routes.ts       # Standalone routing
│   │   │   └── assets/
│   │   │       ├── images/
│   │   │       ├── videos/
│   │   │       └── fonts/
│   │   └── project.json
│   │
│   ├── admin-dashboard/                # 🆕 Angular 21+ admin UI
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── features/
│   │   │   │   │   ├── dashboard/      # Metrics, charts
│   │   │   │   │   │   ├── +state/     # NgRx (REQUIRED)
│   │   │   │   │   │   ├── dashboard.page.ts
│   │   │   │   │   │   ├── dashboard.bo.ts
│   │   │   │   │   │   └── _services/
│   │   │   │   │   │       └── dashboard.service.ts
│   │   │   │   │   ├── licenses/       # License CRUD
│   │   │   │   │   │   ├── +state/     # NgRx
│   │   │   │   │   │   ├── licenses.page.ts
│   │   │   │   │   │   ├── licenses.bo.ts
│   │   │   │   │   │   ├── _clients/
│   │   │   │   │   │   │   └── licenses.client.ts
│   │   │   │   │   │   └── modals/
│   │   │   │   │   │       ├── create-license.modal.ts
│   │   │   │   │   │       └── revoke-license.modal.ts
│   │   │   │   │   ├── users/          # User aggregation
│   │   │   │   │   │   ├── +state/
│   │   │   │   │   │   ├── users.page.ts
│   │   │   │   │   │   └── users.bo.ts
│   │   │   │   │   ├── webhooks/       # Webhook monitoring
│   │   │   │   │   │   ├── +state/
│   │   │   │   │   │   ├── webhooks.page.ts
│   │   │   │   │   │   └── webhooks.bo.ts
│   │   │   │   │   └── analytics/      # Charts, stats
│   │   │   │   │       ├── +state/
│   │   │   │   │       ├── analytics.page.ts
│   │   │   │   │       └── analytics.bo.ts
│   │   │   │   ├── core/
│   │   │   │   │   ├── guards/
│   │   │   │   │   │   └── admin-auth.guard.ts
│   │   │   │   │   └── interceptors/
│   │   │   │   │       └── api-key.interceptor.ts
│   │   │   │   └── app.routes.ts
│   │   │   └── environments/
│   │   └── project.json
│   │
│   ├── license-api/                    # ✅ Existing NestJS API
│   │   ├── src/
│   │   │   ├── license/                # ✅ License CRUD + verify
│   │   │   ├── webhook/                # ✅ Patreon/Stripe/Ko-fi
│   │   │   ├── crypto/                 # ✅ License key signing
│   │   │   ├── email/                  # ✅ Email service
│   │   │   ├── prisma/                 # ✅ Database client
│   │   │   ├── guards/                 # ✅ AdminApiKeyGuard
│   │   │   │
│   │   │   ├── analytics/              # 🆕 Analytics endpoints
│   │   │   │   ├── analytics.module.ts
│   │   │   │   ├── analytics.controller.ts
│   │   │   │   └── _services/
│   │   │   │       └── analytics.service.ts
│   │   │   │
│   │   │   └── patreon/                # 🔄 Migrate from backend
│   │   │       ├── patreon.module.ts
│   │   │       ├── patreon.controller.ts
│   │   │       └── _services/
│   │   │           └── patreon.service.ts
│   │   │
│   │   └── prisma/schema.prisma        # ✅ License database
│   │
│   ├── backend/                        # ✅ Existing BitBonsai backend
│   │   └── src/integrations/patreon/   # 🔄 TO DELETE (migrate to license-api)
│   │
│   └── frontend/                       # ✅ Existing Angular app (BitBonsai UI)
│       └── src/app/features/settings/
│           └── license/                # 🆕 Add license key input
│
└── libs/
    └── shared-types/                   # 🆕 Shared DTOs (License, Tier, etc.)
        ├── src/
        │   ├── lib/
        │   │   ├── license.dto.ts
        │   │   ├── tier.enum.ts
        │   │   ├── webhook.dto.ts
        │   │   └── index.ts
        │   └── index.ts
        └── project.json
```

---

## 🎨 Tech Stack (Nx Monorepo)

| Layer | Technology | Why |
|-------|-----------|-----|
| **Marketing Frontend** | Angular 21+ (Standalone) | Modern, SSR-ready, matches existing stack |
| **Admin Frontend** | Angular 21+ (Standalone) | Reuse components, patterns from `frontend` |
| **State Management** | NgRx (REQUIRED by conventions) | Global state, +state/ folders |
| **Local State** | Angular Signals (REQUIRED) | Reactive local state |
| **Business Logic** | BOs (Business Objects) | Components = UI only, logic in BOs |
| **Backend API** | NestJS | ✅ Existing license-api |
| **Styling** | SCSS + Tailwind CSS | Utility-first, matches Nx conventions |
| **Icons** | FontAwesome Pro | ✅ Already in package.json |
| **Charts** | ng2-charts (Chart.js) | ✅ Already in package.json |
| **Forms** | Angular Reactive Forms | Type-safe, validation |
| **Testing** | Jest (100% coverage REQUIRED) | Matches Nx conventions |
| **i18n** | Angular i18n | REQUIRED by conventions (NO hardcoded strings) |

---

## 🏗️ Code Conventions (CRITICAL)

**From:** `~/git/code-conventions/.specify/memory/constitution-cheat-sheet.md`

### **10 NON-NEGOTIABLE Rules**

| # | Rule | Application |
|---|------|-------------|
| 1 | ❌ **NO `any` types** | All TypeScript files |
| 2 | ✅ **NgRx EVERYWHERE** | +state/ folders in `website` AND `admin-dashboard` |
| 3 | ✅ **BOs for ALL logic** | `.bo.ts` files, components = UI only |
| 4 | ✅ **Signals for local state** | NgRx for global, Signals for component state |
| 5 | ✅ **100% test coverage** | `.spec.ts` for ALL new code |
| 6 | ❌ **NO dead code** | NO useless comments |
| 7 | ✅ **Swagger on ALL endpoints** | @ApiOperation, @ApiResponse |
| 8 | ✅ **Conventional Commits** | Micro-commits |
| 9 | ❌ **NO plain text passwords** | bcrypt/argon2 |
| 10 | ✅ **i18n ALL text** | NO hardcoded strings in templates |

### **File Structure (MUST FOLLOW)**

**Angular (website, admin-dashboard):**
```
[feature]/
├── +state/                    # NgRx (actions, effects, reducers, selectors)
├── _clients/                  # HTTP clients (API calls)
├── _services/                 # Business logic services
├── [feature].bo.ts            # Business objects (ALL logic here!)
├── [feature].page.ts          # Route components (UI only)
└── [feature].modal.ts         # Dialogs (use Angular CDK Dialog)
```

**NestJS (license-api):**
```
[module]/
├── [module].controller.ts            # @ApiOperation, @ApiResponse required
├── _services/[module].service.ts     # Business logic
├── _repositories/[module].repository.ts  # Database access
└── _dtos/[module].dto.ts             # Data transfer objects
```

---

## 🌐 Marketing Website (Angular 21+)

### **Nx Generator Commands**

```bash
# Create website app
nx g @nx/angular:app website --routing --style=scss --standalone

# Generate features
nx g @nx/angular:component features/home --project=website --type=page --standalone
nx g @nx/angular:component features/pricing --project=website --type=page --standalone
nx g @nx/angular:component features/features --project=website --type=page --standalone
nx g @nx/angular:component features/compare --project=website --type=page --standalone
nx g @nx/angular:component features/download --project=website --type=page --standalone

# Generate shared components
nx g @nx/angular:component shared/components/hero --project=website --standalone
nx g @nx/angular:component shared/components/feature-card --project=website --standalone
nx g @nx/angular:component shared/components/pricing-card --project=website --standalone
```

---

### **Routes (`app.routes.ts`)**

```typescript
import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/home/home.page').then(m => m.HomePage) },
  { path: 'features', loadComponent: () => import('./features/features/features.page').then(m => m.FeaturesPage) },
  { path: 'pricing', loadComponent: () => import('./features/pricing/pricing.page').then(m => m.PricingPage) },
  { path: 'compare', loadComponent: () => import('./features/compare/compare.page').then(m => m.ComparePage) },
  { path: 'download', loadComponent: () => import('./features/download/download.page').then(m => m.DownloadPage) },
  { path: 'docs', loadChildren: () => import('./features/docs/docs.routes').then(m => m.DOCS_ROUTES) },
  { path: '**', redirectTo: '' },
];
```

---

### **1. Home Page (`features/home/`)**

**Structure:**
```
home/
├── +state/                    # NgRx (stats, social proof data)
├── home.page.ts               # UI only
├── home.page.html
├── home.page.scss
├── home.bo.ts                 # Logic: format stats, animations
└── _services/
    └── home.service.ts        # Fetch GitHub stars, Docker pulls
```

**Component (`home.page.ts`):**
```typescript
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { HomeBo } from './home.bo';
import { HeroComponent } from '../../shared/components/hero/hero.component';
import { FeatureCardComponent } from '../../shared/components/feature-card/feature-card.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, HeroComponent, FeatureCardComponent],
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
})
export class HomePage {
  private store = inject(Store);
  private bo = inject(HomeBo);

  // Signals for local state (REQUIRED by conventions)
  heroTitle = signal('Trim your library. Not your quality.');
  stats = this.bo.getStats(); // Returns Signal<Stats>
  painPoints = this.bo.getPainPoints();

  ngOnInit() {
    this.bo.loadSocialProof(); // Dispatches NgRx action
  }
}
```

**Business Object (`home.bo.ts`):**
```typescript
import { Injectable, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { HomeActions } from './+state/home.actions';
import { selectStats } from './+state/home.selectors';

export interface PainPoint {
  icon: string; // FontAwesome class
  title: string;
  problem: string;
  solution: string;
}

@Injectable({ providedIn: 'root' })
export class HomeBo {
  private store = inject(Store);

  getStats() {
    return this.store.selectSignal(selectStats);
  }

  getPainPoints(): PainPoint[] {
    return [
      {
        icon: 'fa-solid fa-exclamation-triangle',
        title: 'Crash Anxiety',
        problem: 'Tdarr crashed at 98% - lost 12 hours!',
        solution: 'TRUE RESUME picks up at 98%, not 0%.',
      },
      {
        icon: 'fa-solid fa-plug',
        title: 'Configuration Hell',
        problem: '47+ plugins to configure for 3 days.',
        solution: 'Zero plugins. Smart defaults. Works in 5 minutes.',
      },
      // ... 5 more pain points
    ];
  }

  loadSocialProof(): void {
    this.store.dispatch(HomeActions.loadStats());
  }
}
```

**Template (`home.page.html`):**
```html
<!-- Hero Section -->
<app-hero
  [title]="heroTitle()"
  subtitle="40-60% storage savings. Zero friction."
  [ctaPrimary]="{ label: 'Start in 5 Minutes', link: '/download' }"
  [ctaSecondary]="{ label: 'See Live Demo', link: '/features' }"
/>

<!-- Social Proof -->
<section class="bg-gray-100 py-8">
  <div class="container mx-auto flex justify-around">
    @if (stats(); as statsData) {
      <div class="text-center">
        <fa-icon [icon]="['fab', 'docker']" size="2x"></fa-icon>
        <p class="text-2xl font-bold">{{ statsData.dockerPulls }}</p>
        <p class="text-gray-600" i18n>Docker Pulls</p>
      </div>
      <div class="text-center">
        <fa-icon [icon]="['fab', 'github']" size="2x"></fa-icon>
        <p class="text-2xl font-bold">{{ statsData.githubStars }}</p>
        <p class="text-gray-600" i18n>GitHub Stars</p>
      </div>
      <div class="text-center">
        <fa-icon [icon]="['fas', 'users']" size="2x"></fa-icon>
        <p class="text-2xl font-bold">{{ statsData.activeUsers }}</p>
        <p class="text-gray-600" i18n>Active Users</p>
      </div>
    }
  </div>
</section>

<!-- Pain Points Grid -->
<section class="container mx-auto py-16">
  <h2 class="text-4xl font-bold text-center mb-12" i18n>
    Problems We Solve
  </h2>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
    @for (point of painPoints; track point.title) {
      <app-feature-card
        [icon]="point.icon"
        [title]="point.title"
        [problem]="point.problem"
        [solution]="point.solution"
      />
    }
  </div>
</section>
```

**NgRx State (`+state/`):**
```typescript
// home.actions.ts
export const HomeActions = createActionGroup({
  source: 'Home',
  events: {
    'Load Stats': emptyProps(),
    'Load Stats Success': props<{ stats: Stats }>(),
    'Load Stats Failure': props<{ error: string }>(),
  },
});

// home.effects.ts
@Injectable()
export class HomeEffects {
  private actions$ = inject(Actions);
  private homeService = inject(HomeService);

  loadStats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(HomeActions.loadStats),
      switchMap(() =>
        this.homeService.getStats().pipe(
          map(stats => HomeActions.loadStatsSuccess({ stats })),
          catchError(error => of(HomeActions.loadStatsFailure({ error: error.message })))
        )
      )
    )
  );
}
```

---

### **2. Pricing Page (`features/pricing/`)**

**Component:**
```typescript
@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, PricingCardComponent],
  templateUrl: './pricing.page.html',
  styleUrls: ['./pricing.page.scss'],
})
export class PricingPage {
  private bo = inject(PricingBo);

  tiers = this.bo.getTiers();
  billingPeriod = signal<'monthly' | 'yearly'>('monthly');

  toggleBilling(): void {
    this.billingPeriod.update(current => (current === 'monthly' ? 'yearly' : 'monthly'));
  }
}
```

**Business Object (`pricing.bo.ts`):**
```typescript
export interface Tier {
  name: string;
  price: { monthly: number; yearly: number };
  maxNodes: number;
  maxConcurrentJobs: number;
  features: string[];
  recommended?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PricingBo {
  getTiers(): Tier[] {
    return [
      {
        name: 'FREE',
        price: { monthly: 0, yearly: 0 },
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: ['Perfect for testing', 'Small libraries (< 500 files)'],
      },
      {
        name: 'Supporter',
        price: { monthly: 3, yearly: 30 },
        maxNodes: 2,
        maxConcurrentJobs: 3,
        features: ['Home users', '1-2 servers'],
      },
      {
        name: 'Plus',
        price: { monthly: 5, yearly: 50 },
        maxNodes: 3,
        maxConcurrentJobs: 5,
        features: ['Homelab enthusiasts', 'Multi-server setups'],
        recommended: true,
      },
      // ... Pro, Ultimate
    ];
  }

  calculateYearlySavings(monthlyPrice: number): number {
    return (monthlyPrice * 12) - (monthlyPrice * 10); // 2 months free
  }
}
```

---

## 🔐 Admin Dashboard (Angular 21+)

### **Nx Generator Commands**

```bash
# Create admin-dashboard app
nx g @nx/angular:app admin-dashboard --routing --style=scss --standalone

# Generate features with NgRx
nx g @ngrx/schematics:feature features/licenses --project=admin-dashboard --module=app.routes.ts
nx g @ngrx/schematics:feature features/users --project=admin-dashboard --module=app.routes.ts
nx g @ngrx/schematics:feature features/webhooks --project=admin-dashboard --module=app.routes.ts
nx g @ngrx/schematics:feature features/dashboard --project=admin-dashboard --module=app.routes.ts
```

---

### **Routes (`app.routes.ts`)**

```typescript
import { Routes } from '@angular/router';
import { AdminAuthGuard } from './core/guards/admin-auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.page').then(m => m.LoginPage),
  },
  {
    path: '',
    canActivate: [AdminAuthGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', loadComponent: () => import('./features/dashboard/dashboard.page').then(m => m.DashboardPage) },
      { path: 'licenses', loadComponent: () => import('./features/licenses/licenses.page').then(m => m.LicensesPage) },
      { path: 'users', loadComponent: () => import('./features/users/users.page').then(m => m.UsersPage) },
      { path: 'webhooks', loadComponent: () => import('./features/webhooks/webhooks.page').then(m => m.WebhooksPage) },
      { path: 'analytics', loadComponent: () => import('./features/analytics/analytics.page').then(m => m.AnalyticsPage) },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
```

---

### **Auth Guard (`core/guards/admin-auth.guard.ts`)**

```typescript
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { selectIsAuthenticated } from '../../features/auth/+state/auth.selectors';

export const AdminAuthGuard = (): boolean => {
  const store = inject(Store);
  const router = inject(Router);
  const isAuthenticated = store.selectSignal(selectIsAuthenticated)();

  if (!isAuthenticated) {
    router.navigate(['/login']);
    return false;
  }
  return true;
};
```

---

### **Licenses Page (`features/licenses/`)**

**Structure:**
```
licenses/
├── +state/
│   ├── licenses.actions.ts
│   ├── licenses.effects.ts
│   ├── licenses.reducer.ts
│   └── licenses.selectors.ts
├── _clients/
│   └── licenses.client.ts       # HTTP calls to license-api
├── modals/
│   ├── create-license.modal.ts
│   ├── revoke-license.modal.ts
│   └── view-license.modal.ts
├── licenses.page.ts             # UI only
├── licenses.page.html
├── licenses.page.scss
├── licenses.bo.ts               # Logic: filtering, formatting
└── licenses.page.spec.ts        # 100% coverage required
```

**Component (`licenses.page.ts`):**
```typescript
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Dialog } from '@angular/cdk/dialog';
import { LicensesBo } from './licenses.bo';
import { LicensesActions } from './+state/licenses.actions';
import { selectLicenses, selectTotal } from './+state/licenses.selectors';
import { CreateLicenseModal } from './modals/create-license.modal';

@Component({
  selector: 'app-licenses',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './licenses.page.html',
  styleUrls: ['./licenses.page.scss'],
})
export class LicensesPage {
  private store = inject(Store);
  private dialog = inject(Dialog);
  private bo = inject(LicensesBo);

  licenses = this.store.selectSignal(selectLicenses);
  total = this.store.selectSignal(selectTotal);

  // Local state (Signals)
  page = signal(1);
  tierFilter = signal<string | null>(null);
  searchQuery = signal('');

  ngOnInit() {
    this.loadLicenses();
  }

  loadLicenses(): void {
    this.store.dispatch(
      LicensesActions.loadLicenses({
        page: this.page(),
        tier: this.tierFilter(),
        search: this.searchQuery(),
      })
    );
  }

  openCreateDialog(): void {
    const dialogRef = this.dialog.open(CreateLicenseModal);
    dialogRef.closed.subscribe(result => {
      if (result) {
        this.store.dispatch(LicensesActions.createLicense({ dto: result }));
      }
    });
  }

  revokeLicense(licenseId: string): void {
    if (confirm('Are you sure you want to revoke this license?')) {
      this.store.dispatch(LicensesActions.revokeLicense({ licenseId }));
    }
  }

  nextPage(): void {
    this.page.update(p => p + 1);
    this.loadLicenses();
  }

  filterByTier(tier: string | null): void {
    this.tierFilter.set(tier);
    this.page.set(1);
    this.loadLicenses();
  }

  search(query: string): void {
    this.searchQuery.set(query);
    this.page.set(1);
    this.loadLicenses();
  }
}
```

**Business Object (`licenses.bo.ts`):**
```typescript
import { Injectable } from '@angular/core';
import { LicenseStatus, LicenseTier } from '@bitbonsai/shared-types';

export interface License {
  id: string;
  email: string;
  tier: LicenseTier;
  status: LicenseStatus;
  maxNodes: number;
  maxConcurrentJobs: number;
  expiresAt?: Date;
  createdAt: Date;
}

@Injectable({ providedIn: 'root' })
export class LicensesBo {
  getTierBadgeClass(tier: LicenseTier): string {
    const colors: Record<LicenseTier, string> = {
      FREE: 'bg-gray-100 text-gray-800',
      PATREON_SUPPORTER: 'bg-blue-100 text-blue-800',
      PATREON_PLUS: 'bg-green-100 text-green-800',
      PATREON_PRO: 'bg-purple-100 text-purple-800',
      PATREON_ULTIMATE: 'bg-yellow-100 text-yellow-800',
      COMMERCIAL_STARTER: 'bg-indigo-100 text-indigo-800',
      COMMERCIAL_PRO: 'bg-pink-100 text-pink-800',
      COMMERCIAL_ENTERPRISE: 'bg-red-100 text-red-800',
    };
    return colors[tier];
  }

  getStatusBadgeClass(status: LicenseStatus): string {
    return status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
  }

  formatExpiration(date?: Date): string {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString();
  }
}
```

**Template (`licenses.page.html`):**
```html
<div class="container mx-auto p-6">
  <div class="flex justify-between items-center mb-6">
    <h1 class="text-3xl font-bold" i18n>Licenses</h1>
    <button
      (click)="openCreateDialog()"
      class="bg-green-500 text-white px-4 py-2 rounded">
      <fa-icon [icon]="['fas', 'plus']"></fa-icon>
      <span i18n>Create License</span>
    </button>
  </div>

  <!-- Filters -->
  <div class="bg-white rounded shadow p-4 mb-4 flex gap-4">
    <select
      (change)="filterByTier($any($event.target).value || null)"
      class="border rounded px-4 py-2">
      <option value="" i18n>All Tiers</option>
      <option value="FREE">FREE</option>
      <option value="PATREON_SUPPORTER">Supporter</option>
      <option value="PATREON_PLUS">Plus</option>
      <option value="PATREON_PRO">Pro</option>
      <option value="PATREON_ULTIMATE">Ultimate</option>
    </select>

    <input
      type="text"
      placeholder="Search by email"
      (input)="search($any($event.target).value)"
      class="border rounded px-4 py-2 flex-1"
      i18n-placeholder>
  </div>

  <!-- Table -->
  <div class="bg-white rounded shadow overflow-hidden">
    <table class="w-full">
      <thead class="bg-gray-50 border-b">
        <tr>
          <th class="px-6 py-3 text-left" i18n>Email</th>
          <th class="px-6 py-3 text-left" i18n>Tier</th>
          <th class="px-6 py-3 text-left" i18n>Status</th>
          <th class="px-6 py-3 text-left" i18n>Nodes</th>
          <th class="px-6 py-3 text-left" i18n>Jobs</th>
          <th class="px-6 py-3 text-left" i18n>Expires</th>
          <th class="px-6 py-3 text-left" i18n>Actions</th>
        </tr>
      </thead>
      <tbody>
        @for (license of licenses(); track license.id) {
          <tr class="border-b hover:bg-gray-50">
            <td class="px-6 py-4">{{ license.email }}</td>
            <td class="px-6 py-4">
              <span [class]="bo.getTierBadgeClass(license.tier)" class="px-2 py-1 rounded text-sm">
                {{ license.tier }}
              </span>
            </td>
            <td class="px-6 py-4">
              <span [class]="bo.getStatusBadgeClass(license.status)" class="px-2 py-1 rounded text-sm">
                {{ license.status }}
              </span>
            </td>
            <td class="px-6 py-4">{{ license.maxNodes }}</td>
            <td class="px-6 py-4">{{ license.maxConcurrentJobs }}</td>
            <td class="px-6 py-4">{{ bo.formatExpiration(license.expiresAt) }}</td>
            <td class="px-6 py-4">
              <button (click)="revokeLicense(license.id)" class="text-red-500 hover:text-red-700">
                <fa-icon [icon]="['fas', 'ban']"></fa-icon>
              </button>
            </td>
          </tr>
        }
      </tbody>
    </table>

    <!-- Pagination -->
    <div class="px-6 py-4 flex justify-between items-center">
      <span i18n>Showing {{ licenses().length }} of {{ total() }}</span>
      <div>
        @if (page() > 1) {
          <button (click)="page.update(p => p - 1); loadLicenses()" class="px-4 py-2 border rounded mr-2" i18n>
            Previous
          </button>
        }
        @if (licenses().length === 50) {
          <button (click)="nextPage()" class="px-4 py-2 border rounded" i18n>
            Next
          </button>
        }
      </div>
    </div>
  </div>
</div>
```

**HTTP Client (`_clients/licenses.client.ts`):**
```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CreateLicenseDto, LicenseResponseDto } from '@bitbonsai/shared-types';

@Injectable({ providedIn: 'root' })
export class LicensesClient {
  private http = inject(HttpClient);
  private apiUrl = '/api/licenses';

  getAll(params: { page: number; tier?: string | null; search?: string }): Observable<{ licenses: LicenseResponseDto[]; total: number }> {
    return this.http.get<{ licenses: LicenseResponseDto[]; total: number }>(this.apiUrl, { params: params as any });
  }

  create(dto: CreateLicenseDto): Observable<LicenseResponseDto> {
    return this.http.post<LicenseResponseDto>(this.apiUrl, dto);
  }

  revoke(id: string, reason: string): Observable<LicenseResponseDto> {
    return this.http.post<LicenseResponseDto>(`${this.apiUrl}/${id}/revoke`, { reason });
  }
}
```

---

## 🔌 License API Endpoints (NestJS)

### **New Admin Endpoints to Add**

| Endpoint | Method | Controller | Purpose |
|----------|--------|-----------|---------|
| `GET /api/licenses` | GET | LicenseController | List all (paginated, filtered) |
| `GET /api/licenses/:id` | GET | LicenseController | Get single + activations |
| `PATCH /api/licenses/:id/extend` | PATCH | LicenseController | Update expiresAt |
| `GET /api/webhooks` | GET | WebhookController | List webhook events |
| `POST /api/webhooks/:id/retry` | POST | WebhookController | Retry failed webhook |
| `GET /api/analytics/stats` | GET | AnalyticsController | Dashboard stats |
| `GET /api/analytics/growth` | GET | AnalyticsController | License growth chart |

**Example Controller Extension:**
```typescript
// apps/license-api/src/license/license.controller.ts
@Get()
@UseGuards(AdminApiKeyGuard)
@ApiSecurity('api-key')
@ApiOperation({ summary: 'List all licenses (admin only)' })
@ApiResponse({ status: 200, type: [LicenseResponseDto] })
async findAll(
  @Query('page') page = 1,
  @Query('limit') limit = 50,
  @Query('tier') tier?: LicenseTier,
  @Query('status') status?: LicenseStatus,
  @Query('search') search?: string,
): Promise<{ licenses: LicenseResponseDto[]; total: number }> {
  const { licenses, total } = await this.licenseService.findAll({
    page: Number(page),
    limit: Number(limit),
    tier,
    status,
    search,
  });
  return { licenses, total };
}
```

---

## 📋 Implementation Phases

### **Phase 1: Setup + Shared Library** (Week 1)

- [ ] Create `libs/shared-types` library
  ```bash
  nx g @nx/js:lib shared-types
  ```
- [ ] Define DTOs: `LicenseDto`, `TierEnum`, `WebhookDto`
- [ ] Create `website` Angular app
  ```bash
  nx g @nx/angular:app website --routing --style=scss --standalone
  ```
- [ ] Create `admin-dashboard` Angular app
  ```bash
  nx g @nx/angular:app admin-dashboard --routing --style=scss --standalone
  ```
- [ ] Configure Tailwind CSS for both apps
- [ ] Setup FontAwesome (already in package.json)

### **Phase 2: Marketing Website - Pages** (Week 2)

- [ ] Generate home page with NgRx state
- [ ] Build hero component
- [ ] Build feature-card component
- [ ] Build pricing-card component
- [ ] Create pricing page with tier logic (BO)
- [ ] Create features page
- [ ] Create compare page (vs Tdarr)
- [ ] Create download page
- [ ] Add i18n for all text (REQUIRED)
- [ ] Write tests (100% coverage REQUIRED)

### **Phase 3: Admin Dashboard - Auth + Dashboard** (Week 3)

- [ ] Create login page with auth state
- [ ] Implement AdminAuthGuard
- [ ] Create dashboard home with analytics
- [ ] Add AnalyticsController to license-api
- [ ] Create charts with ng2-charts
- [ ] Write tests (100% coverage)

### **Phase 4: Admin Dashboard - CRUD Pages** (Week 4)

- [ ] Create Licenses page with NgRx
- [ ] Build LicensesClient (HTTP calls)
- [ ] Create modals: create, revoke, view
- [ ] Add endpoints to license-api: `GET /api/licenses`, etc.
- [ ] Create Users page (aggregated view)
- [ ] Create Webhooks page
- [ ] Add webhook retry endpoint
- [ ] Write tests (100% coverage)

### **Phase 5: Patreon OAuth Migration** (Week 5)

- [ ] Move Patreon integration from `backend` to `license-api`
- [ ] Update imports: `@prisma/client` → `.prisma/license-client`
- [ ] Test Patreon webhook flow
- [ ] Add user-facing license page to `frontend` (BitBonsai UI)
- [ ] Write tests

### **Phase 6: Polish + Deploy** (Week 6)

- [ ] SEO: meta tags, sitemap, robots.txt
- [ ] Mobile responsive (Tailwind breakpoints)
- [ ] Performance: lazy loading, image optimization
- [ ] Deploy `website` (static hosting or Nginx)
- [ ] Deploy `admin-dashboard` (static hosting)
- [ ] Deploy `license-api` (Docker)
- [ ] DNS: bitbonsai.io → servers

---

## 🚀 Deployment

### **Build Commands**

```bash
# Build marketing website (production)
nx build website --configuration=production

# Build admin dashboard (production)
nx build admin-dashboard --configuration=production

# Build license-api (NestJS)
nx build license-api --configuration=production

# Run all builds
nx run-many -t build --configuration=production
```

### **Serve Commands (Development)**

```bash
# Serve marketing website
nx serve website

# Serve admin dashboard
nx serve admin-dashboard

# Serve license-api
nx serve license-api
```

---

## 🎯 Key Differences from Previous Plans

| Aspect | v1 (Next.js) | v2 (NestJS SSR) | v3 (Angular) ✅ |
|--------|--------------|-----------------|-----------------|
| **Framework** | Next.js 14 | NestJS + EJS | Angular 21+ |
| **State** | React Context | N/A (SSR) | NgRx (REQUIRED) |
| **Architecture** | Separate apps | Monolith | Nx monorepo |
| **Logic** | React hooks | Services | BOs (REQUIRED) |
| **Testing** | Jest optional | Jest | 100% coverage (REQUIRED) |
| **Code Style** | Free-form | Free-form | Code conventions (ENFORCED) |
| **Stack Match** | ❌ New stack | ⚠️ Partial | ✅ Matches existing |

---

## ✅ Advantages of Angular Approach

1. **Matches Existing Stack** - Frontend already Angular 20+, reuse patterns
2. **Code Conventions** - Enforced via constitution (NgRx, BOs, tests)
3. **Team Expertise** - Already using Angular + NestJS
4. **Component Reuse** - Share components between `frontend` and `admin-dashboard`
5. **Type Safety** - `shared-types` library, compile-time checks
6. **Nx Tooling** - Generators, dependency graph, caching
7. **FontAwesome Pro** - Already licensed and in package.json
8. **i18n Ready** - Angular i18n, REQUIRED by conventions
9. **100% Test Coverage** - Enforced by constitution
10. **Consistent Style** - Same patterns as existing BitBonsai frontend

---

## 📦 Deliverables

| Component | Path | Description |
|-----------|------|-------------|
| Marketing Website | `apps/website/` | Angular 21+ standalone app |
| Admin Dashboard | `apps/admin-dashboard/` | Angular 21+ admin UI |
| Shared Types | `libs/shared-types/` | DTOs, enums, interfaces |
| License API Extensions | `apps/license-api/src/` | New endpoints (analytics, list, etc.) |
| Patreon Migration | `apps/license-api/src/patreon/` | OAuth flow from backend |

---

**Next Steps:**
1. Review Angular-based plan
2. Approve code conventions integration
3. Run `/conventions` to load constitution
4. Start Phase 1 (setup + shared types)
5. Plan screenshot/video production for marketing
