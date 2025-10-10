# Missing Test Files - BitBonsai

This document lists all source files without corresponding test files.

## Backend - 122 files without tests (100%)

**Note:** Backend uses centralized `__tests__` directories instead of co-located `.spec.ts` files. However, many files still lack any test coverage.

### Critical Priority (P0) - Core Business Logic

#### Authentication (9 files - 0% coverage)
- [ ] `apps/backend/src/auth/auth.controller.ts`
- [ ] `apps/backend/src/auth/auth.service.ts`
- [ ] `apps/backend/src/auth/auth.module.ts`
- [ ] `apps/backend/src/auth/dto/login.dto.ts`
- [ ] `apps/backend/src/auth/dto/auth-response.dto.ts`
- [ ] `apps/backend/src/auth/guards/jwt.guard.ts`
- [ ] `apps/backend/src/auth/guards/api-key.guard.ts` ⚠️
- [ ] `apps/backend/src/auth/strategies/jwt.strategy.ts`
- [ ] `apps/backend/src/auth/strategies/api-key.strategy.ts`

#### Encoding (4 files - Partial coverage)
- [ ] `apps/backend/src/encoding/encoding-processor.service.ts` ⚠️ (Has tests but failing)
- [ ] `apps/backend/src/encoding/ffmpeg.service.ts` ⚠️ (Has tests but complex)
- [ ] `apps/backend/src/encoding/encoding.module.ts`
- [ ] `apps/backend/src/encoding/dto/encoding-progress.dto.ts`

#### Queue (9 files - Partial coverage)
- [ ] `apps/backend/src/queue/queue.service.ts` ⚠️ (Has tests but incomplete)
- [ ] `apps/backend/src/queue/queue.controller.ts`
- [ ] `apps/backend/src/queue/queue.module.ts`
- [ ] `apps/backend/src/queue/dto/job-stats.dto.ts`
- [ ] `apps/backend/src/queue/dto/complete-job.dto.ts`
- [ ] `apps/backend/src/queue/dto/create-job.dto.ts`
- [ ] `apps/backend/src/queue/dto/fail-job.dto.ts`
- [ ] `apps/backend/src/queue/dto/update-job.dto.ts`
- [ ] `apps/backend/src/queue/services/job-cleanup.service.ts` (Has tests)

#### Nodes (10 files - Partial coverage)
- [ ] `apps/backend/src/nodes/nodes.service.ts` ⚠️ (Has tests but incomplete)
- [ ] `apps/backend/src/nodes/nodes.controller.ts`
- [ ] `apps/backend/src/nodes/nodes.module.ts`
- [ ] `apps/backend/src/nodes/dto/node-response.dto.ts`
- [ ] `apps/backend/src/nodes/dto/node-registration-response.dto.ts`
- [ ] `apps/backend/src/nodes/dto/register-node.dto.ts`
- [ ] `apps/backend/src/nodes/dto/heartbeat.dto.ts`
- [ ] `apps/backend/src/nodes/dto/pair-node.dto.ts`
- [ ] `apps/backend/src/nodes/dto/current-node.dto.ts`
- [ ] `apps/backend/src/nodes/dto/node-stats.dto.ts`

### High Priority (P1) - Infrastructure

#### Error Handling (9 files - 0% coverage) ⚠️
- [ ] `apps/backend/src/common/errors/base.error.ts`
- [ ] `apps/backend/src/common/errors/business.error.ts`
- [ ] `apps/backend/src/common/errors/validation.error.ts`
- [ ] `apps/backend/src/common/errors/not-found.error.ts`
- [ ] `apps/backend/src/common/errors/conflict.error.ts`
- [ ] `apps/backend/src/common/errors/authorization.error.ts`
- [ ] `apps/backend/src/common/errors/external.error.ts`
- [ ] `apps/backend/src/common/errors/index.ts`
- [ ] `apps/backend/src/common/filters/global-exception.filter.ts` ⚠️

#### Logging (5 files - 0% coverage)
- [ ] `apps/backend/src/common/logging/logger.service.ts`
- [ ] `apps/backend/src/common/logging/logger.config.ts`
- [ ] `apps/backend/src/common/logging/http-logger.middleware.ts`
- [ ] `apps/backend/src/common/logging/index.ts`

#### Health (11 files - 11.76% coverage)
- [ ] `apps/backend/src/health/health.service.ts` (Partial coverage)
- [ ] `apps/backend/src/health/health.controller.ts`
- [ ] `apps/backend/src/health/health.module.ts`
- [ ] `apps/backend/src/health/dto/basic-health.dto.ts`
- [ ] `apps/backend/src/health/dto/detailed-health.dto.ts`
- [ ] `apps/backend/src/health/dto/disk-health.dto.ts`
- [ ] `apps/backend/src/health/dto/health-checks.dto.ts`
- [ ] `apps/backend/src/health/dto/liveness.dto.ts`
- [ ] `apps/backend/src/health/dto/memory-health.dto.ts`
- [ ] `apps/backend/src/health/dto/node-health.dto.ts`
- [ ] `apps/backend/src/health/dto/queue-health.dto.ts`
- [ ] `apps/backend/src/health/dto/readiness.dto.ts`
- [ ] `apps/backend/src/health/dto/service-health.dto.ts`

### Medium Priority (P2) - Supporting Modules

#### Libraries (11 files - Partial coverage)
- [ ] `apps/backend/src/libraries/libraries.service.ts` (Has tests)
- [ ] `apps/backend/src/libraries/libraries.controller.ts`
- [ ] `apps/backend/src/libraries/libraries.module.ts`
- [ ] `apps/backend/src/libraries/dto/create-library.dto.ts`
- [ ] `apps/backend/src/libraries/dto/update-library.dto.ts`
- [ ] `apps/backend/src/libraries/dto/library-response.dto.ts`
- [ ] `apps/backend/src/libraries/dto/library-stats.dto.ts`

#### Policies (15 files - Partial coverage)
- [ ] `apps/backend/src/policies/policies.service.ts` (Has tests)
- [ ] `apps/backend/src/policies/policies.controller.ts`
- [ ] `apps/backend/src/policies/policies.module.ts`
- [ ] `apps/backend/src/policies/repositories/policy.repository.ts`
- [ ] DTOs (8 files)

#### Insights (15+ files - Partial coverage)
- [ ] `apps/backend/src/insights/insights.service.ts` (Has tests)
- [ ] `apps/backend/src/insights/insights.controller.ts`
- [ ] `apps/backend/src/insights/insights.module.ts`
- [ ] DTOs (12+ files)

#### File Watcher (4 files - 29.11% coverage)
- [ ] `apps/backend/src/file-watcher/file-watcher.service.ts` (Partial coverage)
- [ ] `apps/backend/src/file-watcher/file-watcher.module.ts`

#### Other Services
- [ ] `apps/backend/src/filesystem/filesystem.service.ts` (15.15% coverage)
- [ ] `apps/backend/src/prisma/prisma.service.ts`
- [ ] `apps/backend/src/common/environment.service.ts`
- [ ] `apps/backend/src/license/license.service.ts` (Has tests)
- [ ] `apps/backend/src/overview/overview.service.ts` (Has tests)
- [ ] `apps/backend/src/media-stats/media-stats.service.ts`
- [ ] `apps/backend/src/settings/settings.service.ts`

---

## Frontend - 81 files without tests (74%)

### Critical Priority (P0) - Core Infrastructure

#### Routing & App Shell (2 files)
- [ ] `apps/frontend/src/app/app.routes.ts` ⚠️
- [ ] `apps/frontend/src/app/app.component.ts` ⚠️

#### API Clients (10 files - 0% coverage) ⚠️ CRITICAL
- [ ] `apps/frontend/src/app/core/clients/overview.client.ts`
- [ ] `apps/frontend/src/app/core/clients/nodes.client.ts`
- [ ] `apps/frontend/src/app/core/clients/insights.client.ts`
- [ ] `apps/frontend/src/app/core/clients/queue.client.ts`
- [ ] `apps/frontend/src/app/core/clients/media-stats.client.ts`
- [ ] `apps/frontend/src/app/core/clients/policy.client.ts`
- [ ] `apps/frontend/src/app/core/clients/libraries.client.ts`
- [ ] `apps/frontend/src/app/core/clients/index.ts`

#### Interceptors & Guards (2 files - 0% coverage) ⚠️
- [ ] `apps/frontend/src/app/core/interceptors/api-error.interceptor.ts`
- [ ] `apps/frontend/src/app/core/guards/main-node.guard.ts`

#### Services (2 files - 0% coverage)
- [ ] `apps/frontend/src/app/core/services/node.service.ts`
- [ ] `apps/frontend/src/app/core/services/api-error.service.ts`

#### Layout Components (1 file)
- [ ] `apps/frontend/src/app/core/layout/sidebar/sidebar.component.ts`

### High Priority (P1) - State Management

#### Current Node State (4 files - 0% coverage) ⚠️
- [ ] `apps/frontend/src/app/core/+state/current-node.effects.ts`
- [ ] `apps/frontend/src/app/core/+state/current-node.reducer.ts`
- [ ] `apps/frontend/src/app/core/+state/current-node.selectors.ts`
- [ ] `apps/frontend/src/app/core/+state/current-node.actions.ts`

#### Insights State (3 files - 0% coverage)
- [ ] `apps/frontend/src/app/features/insights/+state/insights.reducer.ts`
- [ ] `apps/frontend/src/app/features/insights/+state/insights.actions.ts`
- [ ] `apps/frontend/src/app/features/insights/+state/insights.selectors.ts`

#### Settings State (3 files - 0% coverage)
- [ ] `apps/frontend/src/app/features/settings/+state/settings.reducer.ts`
- [ ] `apps/frontend/src/app/features/settings/+state/settings.actions.ts`
- [ ] `apps/frontend/src/app/features/settings/+state/settings.selectors.ts`

#### Other Feature States
- [ ] Dashboard state (3 files)
- [ ] Libraries state (3 files)
- [ ] Nodes state (3 files)
- [ ] Policies state (3 files)
- [ ] Queue state (3 files)

### High Priority (P1) - Business Objects

#### Insights BOs (4 files - 0% coverage) ⚠️
- [ ] `apps/frontend/src/app/features/insights/bos/node-performance.bo.ts`
- [ ] `apps/frontend/src/app/features/insights/bos/savings-trend.bo.ts`
- [ ] `apps/frontend/src/app/features/insights/bos/codec-distribution.bo.ts`
- [ ] `apps/frontend/src/app/features/insights/bos/insights-stats.bo.ts`

#### Queue BOs (1 file - 0% coverage)
- [ ] `apps/frontend/src/app/features/queue/bos/queue-job.bo.ts`

#### Policies BOs (1 file - Has tests)
- [x] `apps/frontend/src/app/features/policies/bos/policy.bo.ts` (Tested)

#### Dashboard BOs (3 files - Has tests)
- [x] `apps/frontend/src/app/features/dashboard/bos/media-stats.bo.ts` (Tested)
- [x] `apps/frontend/src/app/features/dashboard/bos/file-info.bo.ts` (Tested)
- [x] `apps/frontend/src/app/features/dashboard/bos/folder-stats.bo.ts` (Tested)

### Medium Priority (P2) - Page Components

#### Complex Pages (Need tests for business logic)
- [ ] `apps/frontend/src/app/features/nodes/nodes.page.ts` (510 LOC) ⚠️
- [ ] `apps/frontend/src/app/features/insights/insights.page.ts` (338 LOC)
- [ ] `apps/frontend/src/app/features/settings/settings.page.ts` (305 LOC) ⚠️ Memory leak!
- [ ] `apps/frontend/src/app/features/queue/queue.page.ts` (279 LOC)
- [ ] `apps/frontend/src/app/features/policies/policies.page.ts` (257 LOC)
- [ ] `apps/frontend/src/app/features/libraries/libraries.page.ts`
- [ ] `apps/frontend/src/app/features/dashboard/dashboard.page.ts`

#### Page Services
- [ ] Insights service
- [ ] Queue service
- [ ] Policies service
- [ ] Libraries service
- [ ] Settings service

---

## Testing Priority Matrix

### CRITICAL (Fix This Week)
1. **Frontend API clients** (10 files) - No API layer testing!
2. **Frontend state management** (20+ files) - No NgRx testing!
3. **Backend auth module** (9 files) - Security-critical!
4. **Fix failing backend tests** (47 tests) - CI/CD blocker!
5. **settings.page.ts memory leaks** (8 subscriptions) - Production issue!

### HIGH (Fix This Sprint)
6. **Frontend BOs** (8 files) - Business logic untested
7. **Backend error handling** (9 files) - Error flow untested
8. **Encoding services** (2 files) - Core functionality gaps
9. **Queue services** (9 files) - Job orchestration untested

### MEDIUM (Backlog)
10. **Health checks** (11 files) - Monitoring untested
11. **Page components** (7 files) - UI logic untested
12. **Logging infrastructure** (5 files) - Observability untested

---

## Estimated Test Development Effort

### Backend
- **Auth module:** 2 days (9 files, security-critical)
- **Encoding services:** 3 days (complex FFmpeg logic)
- **Queue services:** 2 days (orchestration logic)
- **Error handling:** 1 day (simple error classes)
- **Health checks:** 1 day (mostly DTOs)
- **Other modules:** 3 days (libraries, policies, insights)

**Total Backend:** ~12 days (2.5 weeks)

### Frontend
- **API clients:** 2 days (10 files, mock HTTP)
- **NgRx state:** 5 days (20+ files, effects testing complex)
- **Business objects:** 2 days (8 files, transformation logic)
- **Page components:** 3 days (7 files, component testing)
- **Infrastructure:** 1 day (guards, interceptors)

**Total Frontend:** ~13 days (2.5 weeks)

---

## Quick Wins (< 1 Day Each)

1. **Fix settings.page.ts memory leaks** (1 hour) - Add takeUntilDestroyed()
2. **Test error classes** (2 hours) - Simple unit tests
3. **Test DTOs** (4 hours) - Validation testing
4. **Fix failing auth E2E test** (1 hour) - Environment config
5. **Fix encoding metrics test** (2 hours) - Mock adjustment

**Total Quick Wins:** 1 day, significant impact

---

## Testing Guidelines

### Backend Tests
```typescript
// Unit test pattern
describe('ServiceName', () => {
  let service: ServiceName;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServiceName,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(ServiceName);
  });

  it('should do something', async () => {
    // Arrange
    mockPrisma.model.findUnique.mockResolvedValue(mockData);

    // Act
    const result = await service.method();

    // Assert
    expect(result).toEqual(expected);
  });
});
```

### Frontend Tests
```typescript
// Component test pattern
describe('ComponentName', () => {
  let spectator: Spectator<ComponentName>;
  let store: MockStore;

  const createComponent = createComponentFactory({
    component: ComponentName,
    providers: [provideMockStore()],
  });

  beforeEach(() => {
    spectator = createComponent();
    store = spectator.inject(MockStore);
  });

  it('should dispatch action on click', () => {
    spyOn(store, 'dispatch');
    spectator.click('[data-test="button"]');
    expect(store.dispatch).toHaveBeenCalledWith(expectedAction());
  });
});
```

---

**Last Updated:** October 8, 2025
**Total Missing Tests:** 203 files
**Estimated Effort:** 5 weeks (with 2 developers working in parallel)
