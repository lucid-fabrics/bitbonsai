# Test Coverage Action Plan - BitBonsai

**Current Status:** 🚨 CRITICAL
- **Backend Coverage:** 60.81% (Target: 80%)
- **Frontend Coverage:** 2.67% (Target: 80%)
- **Failing Tests:** 47 backend tests failing

**Goal:** Achieve 80%+ test coverage across the codebase within 5 weeks

---

## Week 1: Critical Fixes & Quick Wins

### Day 1 (Monday) - Fix Failing Tests ⚠️ URGENT
**Goal:** Get CI/CD green (47 failing tests → 0)

#### Morning (4 hours)
1. **Fix auth.e2e.spec.ts** (1 hour)
   ```bash
   # Issue: Environment password mismatch
   # File: apps/backend/src/auth/__tests__/auth.e2e.spec.ts
   # Fix: Update test environment configuration
   ```

2. **Fix encoding-processor.service.spec.ts** (2 hours)
   ```bash
   # Issue: Metrics calculation (savedBytes = 0 instead of 250000000)
   # File: apps/backend/src/encoding/__tests__/unit/encoding-processor.service.spec.ts
   # Fix: Update mock data to match implementation
   ```

3. **Fix encoding-processor.service.integration.spec.ts** (1 hour)
   ```bash
   # Issue: Missing FileWatcherService in test module
   # File: apps/backend/src/encoding/__tests__/integration/encoding-processor.service.integration.spec.ts
   # Fix: Add FileWatcherService mock provider
   ```

#### Afternoon (4 hours)
4. **Fix remaining 44 test failures** (4 hours)
   - Review test output logs
   - Fix dependency injection issues
   - Update mock configurations
   - Verify all tests pass

**Deliverable:** All 267 backend tests passing ✅

---

### Day 2 (Tuesday) - Critical Memory Leaks ⚠️
**Goal:** Fix production memory leaks

#### Morning (2 hours)
1. **Fix settings.page.ts subscriptions** (2 hours)
   ```typescript
   // File: apps/frontend/src/app/features/settings/settings.page.ts
   // Issue: 8 unsubscribed observables

   import { DestroyRef, inject } from '@angular/core';
   import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

   export class SettingsPage {
     private destroyRef = inject(DestroyRef);

     ngOnInit() {
       // Before:
       this.store.select(...).subscribe(...);

       // After:
       this.store.select(...)
         .pipe(takeUntilDestroyed(this.destroyRef))
         .subscribe(...);
     }
   }
   ```

#### Afternoon (6 hours)
2. **Fix remaining memory leaks** (6 hours)
   - app.component.ts (1 subscription)
   - libraries.page.ts (1 subscription)
   - policies.page.ts (1 subscription)
   - dashboard.page.ts (1 subscription)

**Deliverable:** 0 memory leaks in production ✅

---

### Day 3 (Wednesday) - Backend Error Handling Tests
**Goal:** Test error handling infrastructure (0% → 100%)

#### Tasks (8 hours)
1. **Test error classes** (2 hours)
   ```typescript
   // apps/backend/src/common/errors/__tests__/error-classes.spec.ts
   describe('Error Classes', () => {
     describe('BusinessError', () => {
       it('should create error with message and code', () => {
         const error = new BusinessError('Invalid operation');
         expect(error.message).toBe('Invalid operation');
         expect(error.statusCode).toBe(400);
       });
     });
     // Test all 8 error classes
   });
   ```

2. **Test global exception filter** (3 hours)
   ```typescript
   // apps/backend/src/common/filters/__tests__/global-exception.filter.spec.ts
   ```

3. **Test API key guard** (2 hours)
   ```typescript
   // apps/backend/src/auth/guards/__tests__/api-key.guard.spec.ts
   ```

4. **Run coverage report** (1 hour)
   ```bash
   npx nx test backend --coverage
   # Verify error module coverage > 80%
   ```

**Deliverable:** Error handling at 100% coverage ✅

---

### Day 4 (Thursday) - Frontend API Clients ⚠️ CRITICAL
**Goal:** Test all API communication layer (0% → 100%)

#### Tasks (8 hours)
1. **Setup testing infrastructure** (1 hour)
   ```typescript
   // Test helper for HTTP mocking
   // apps/frontend/src/app/testing/http-client-testing.helper.ts
   ```

2. **Test API clients** (6 hours)
   - overview.client.ts (1 hour)
   - nodes.client.ts (1 hour)
   - insights.client.ts (1 hour)
   - queue.client.ts (1 hour)
   - media-stats.client.ts (1 hour)
   - policy.client.ts (30 min)
   - libraries.client.ts (30 min)

3. **Test interceptors & guards** (1 hour)
   - api-error.interceptor.ts
   - main-node.guard.ts

**Deliverable:** API layer at 100% coverage ✅

---

### Day 5 (Friday) - Frontend Business Objects
**Goal:** Test data transformation logic (0% → 100%)

#### Tasks (8 hours)
1. **Test Insights BOs** (4 hours)
   ```typescript
   // apps/frontend/src/app/features/insights/bos/__tests__/node-performance.bo.spec.ts
   describe('NodePerformanceBo', () => {
     it('should transform API data to BO', () => {
       const apiData = { /* mock API response */ };
       const bo = NodePerformanceBo.fromApiResponse(apiData);
       expect(bo.throughputPerHour).toBe(expected);
     });
   });
   ```
   - node-performance.bo.ts (1 hour)
   - savings-trend.bo.ts (1 hour)
   - codec-distribution.bo.ts (1 hour)
   - insights-stats.bo.ts (1 hour)

2. **Test Queue BOs** (1 hour)
   - queue-job.bo.ts

3. **Test other BOs** (3 hours)
   - Verify existing BO tests pass
   - Add missing edge case tests

**Deliverable:** All BOs at 100% coverage ✅

---

**Week 1 Summary:**
- ✅ All tests passing (0 failures)
- ✅ No memory leaks
- ✅ Error handling tested
- ✅ API clients tested
- ✅ Business objects tested
- **Estimated Coverage Gain:** Frontend 2.67% → 25%, Backend 60.81% → 70%

---

## Week 2: Frontend State Management

### Day 6-7 (Mon-Tue) - NgRx Current Node State
**Goal:** Test core state management (4 files)

#### Tasks (16 hours)
1. **Test current-node.reducer.ts** (4 hours)
   ```typescript
   describe('currentNodeReducer', () => {
     it('should set current node on success', () => {
       const action = CurrentNodeActions.setCurrentNodeSuccess({ node });
       const state = currentNodeReducer(initialState, action);
       expect(state.currentNode).toEqual(node);
     });
   });
   ```

2. **Test current-node.effects.ts** (6 hours)
   ```typescript
   describe('CurrentNodeEffects', () => {
     it('should load current node on init', () => {
       actions$ = hot('-a', { a: CurrentNodeActions.loadCurrentNode() });
       const response = cold('-b|', { b: mockNode });
       nodesClient.getCurrentNode.mockReturnValue(response);

       expect(effects.loadCurrentNode$).toBeObservable(
         hot('--c', { c: CurrentNodeActions.loadCurrentNodeSuccess({ node: mockNode }) })
       );
     });
   });
   ```

3. **Test current-node.selectors.ts** (4 hours)
4. **Test current-node.actions.ts** (2 hours)

**Deliverable:** Core state at 100% coverage ✅

---

### Day 8-9 (Wed-Thu) - Feature State Modules
**Goal:** Test all feature state (Insights, Settings, etc.)

#### Tasks (16 hours)
Each feature state (3 files each): reducer, effects, selectors

1. **Insights state** (5 hours)
2. **Settings state** (5 hours)
3. **Dashboard state** (3 hours)
4. **Libraries state** (3 hours)

**Deliverable:** Feature state at 100% coverage ✅

---

### Day 10 (Friday) - Remaining Feature States
**Goal:** Complete state management testing

#### Tasks (8 hours)
1. **Nodes state** (3 hours)
2. **Policies state** (3 hours)
3. **Queue state** (2 hours)

**Deliverable:** All NgRx state at 100% coverage ✅

---

**Week 2 Summary:**
- **Estimated Coverage Gain:** Frontend 25% → 60%

---

## Week 3: Backend Core Services

### Day 11-12 (Mon-Tue) - Authentication Module
**Goal:** Test security-critical auth (9 files)

#### Tasks (16 hours)
1. **auth.service.ts** (6 hours)
   - User validation
   - JWT token generation
   - Password hashing verification

2. **auth.controller.ts** (4 hours)
   - Login endpoint
   - Token refresh
   - Logout

3. **JWT strategy** (3 hours)
4. **API key strategy** (3 hours)

**Deliverable:** Auth module at 100% coverage ✅

---

### Day 13-14 (Wed-Thu) - Encoding Services
**Goal:** Test FFmpeg integration (2 complex files)

#### Tasks (16 hours)
1. **ffmpeg.service.ts** (10 hours)
   - Hardware acceleration detection
   - Command building
   - Progress parsing
   - Process management
   - **Challenge:** 641 LOC, complex logic

2. **encoding-processor.service.ts** (6 hours)
   - Job processing pipeline
   - Verification logic
   - Metrics calculation
   - **Note:** Already has tests, improve coverage

**Deliverable:** Encoding at 80%+ coverage ✅

---

### Day 15 (Friday) - Queue Services
**Goal:** Test job orchestration (9 files)

#### Tasks (8 hours)
1. **queue.service.ts** (5 hours)
   - Job queueing
   - Priority management
   - Status updates
   - Statistics

2. **Queue DTOs** (3 hours)
   - Validation testing

**Deliverable:** Queue module at 80%+ coverage ✅

---

**Week 3 Summary:**
- **Estimated Coverage Gain:** Backend 70% → 80%

---

## Week 4: Frontend Components & Services

### Day 16-18 (Mon-Wed) - Page Components
**Goal:** Test complex UI logic (7 pages)

#### Tasks (24 hours)
1. **nodes.page.ts** (6 hours) - 510 LOC, highest priority
2. **insights.page.ts** (4 hours) - 338 LOC
3. **settings.page.ts** (4 hours) - 305 LOC
4. **queue.page.ts** (3 hours) - 279 LOC
5. **policies.page.ts** (3 hours) - 257 LOC
6. **libraries.page.ts** (2 hours)
7. **dashboard.page.ts** (2 hours)

**Focus:** Business logic, not DOM testing

**Deliverable:** All pages at 80%+ coverage ✅

---

### Day 19-20 (Thu-Fri) - Feature Services
**Goal:** Test service layer (8 files)

#### Tasks (16 hours)
1. **insights.service.ts** (3 hours)
2. **queue.service.ts** (3 hours)
3. **policies.service.ts** (3 hours)
4. **libraries.service.ts** (3 hours)
5. **settings.service.ts** (2 hours)
6. **license.service.ts** (2 hours)

**Deliverable:** Feature services at 100% coverage ✅

---

**Week 4 Summary:**
- **Estimated Coverage Gain:** Frontend 60% → 80%

---

## Week 5: Backend Supporting Modules

### Day 21-22 (Mon-Tue) - Nodes & Libraries
**Goal:** Test node management and library services

#### Tasks (16 hours)
1. **nodes.service.ts** (6 hours)
   - Node registration
   - Pairing flow
   - Heartbeat handling
   - Statistics

2. **libraries.service.ts** (5 hours)
   - Library creation
   - File scanning
   - Statistics updates

3. **DTOs & Controllers** (5 hours)

**Deliverable:** Nodes & Libraries at 80%+ coverage ✅

---

### Day 23-24 (Wed-Thu) - Policies & Insights
**Goal:** Test policy engine and analytics

#### Tasks (16 hours)
1. **policies.service.ts** (6 hours)
   - Policy CRUD
   - Preset handling
   - Validation

2. **insights.service.ts** (6 hours)
   - Metrics aggregation
   - Time-series queries
   - Node comparison

3. **policy.repository.ts** (4 hours)

**Deliverable:** Policies & Insights at 80%+ coverage ✅

---

### Day 25 (Friday) - Final Coverage Push
**Goal:** Achieve 80%+ coverage across all modules

#### Tasks (8 hours)
1. **Run full coverage report** (1 hour)
   ```bash
   npx nx test backend --coverage
   npx nx test frontend --coverage
   ```

2. **Identify remaining gaps** (2 hours)
3. **Fill critical gaps** (5 hours)
   - Focus on branches <80%
   - Add edge case tests
   - Test error paths

**Deliverable:** 80%+ coverage achieved ✅

---

**Week 5 Summary:**
- **Final Coverage:** Backend 80%+, Frontend 80%+
- **Total Tests Written:** ~500+ tests
- **Files Tested:** 203 files

---

## Coverage Tracking Dashboard

### Week-by-Week Target
```
Week  Backend  Frontend  Failing Tests  Priority
────────────────────────────────────────────────────
  0    60.81%    2.67%        47         CRITICAL
  1    70%       25%           0         Fix tests
  2    70%       60%           0         State mgmt
  3    80%       60%           0         Core services
  4    80%       80%           0         Components
  5    85%+      85%+          0         Polish
```

### Daily Checklist
```bash
# Run after each testing session
npx nx test backend --coverage
npx nx test frontend --coverage

# Verify no regressions
npx nx affected:test

# Update tracking spreadsheet
# Document lessons learned
```

---

## Testing Best Practices

### 1. Test Organization
```
Good ✅
apps/backend/src/auth/__tests__/
├── unit/
│   ├── auth.service.spec.ts
│   └── strategies.spec.ts
├── integration/
│   └── auth.integration.spec.ts
└── e2e/
    └── auth.e2e.spec.ts

Acceptable ✅ (Current backend structure)
apps/backend/src/auth/
├── auth.service.ts
└── __tests__/
    ├── unit/
    ├── integration/
    └── e2e/
```

### 2. Test Coverage Targets
```
Type                 Target    Rationale
────────────────────────────────────────────────────
Security (auth)      100%      Critical
Core business logic   90%+     High risk
Infrastructure        80%+     Standard
DTOs                  60%+     Low complexity
Constants/Enums       50%+     Low value
```

### 3. Test Pyramid
```
     E2E (10%)
    ─────────
   Integration (20%)
  ───────────────────
 Unit Tests (70%)
─────────────────────────
```

### 4. Mock Strategy
```typescript
// ✅ Good: Mock external dependencies
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
};

// ❌ Bad: Mock internal logic
const mockBusinessLogic = jest.fn().mockReturnValue(true);

// ✅ Good: Test business logic directly
expect(service.validateUser(user)).toBe(true);
```

---

## Risk Mitigation

### If Behind Schedule
**Priority Cut Order:**
1. Keep: P0 Critical (auth, API clients, state)
2. Keep: P1 High (core services, encoding, queue)
3. Defer: P2 Medium (health checks, logging)
4. Defer: DTOs (low complexity, auto-validated)

### If Tests Failing in CI/CD
1. **DO NOT** skip tests
2. **DO NOT** reduce coverage thresholds
3. **DO** fix tests immediately (stop feature work)
4. **DO** add tests to prevent regressions

---

## Success Metrics

### Week 1
- [ ] 0 failing tests
- [ ] 0 memory leaks
- [ ] Error handling 100% coverage
- [ ] API clients 100% coverage

### Week 2
- [ ] NgRx state 100% coverage
- [ ] Frontend 60%+ overall

### Week 3
- [ ] Auth 100% coverage
- [ ] Encoding 80%+ coverage
- [ ] Backend 80%+ overall

### Week 4
- [ ] All pages 80%+ coverage
- [ ] Frontend 80%+ overall

### Week 5
- [ ] All modules 80%+ coverage
- [ ] Zero regressions
- [ ] Documentation complete

---

## Resources

### Testing Tools
- **Backend:** Jest, Supertest, Prisma mocks
- **Frontend:** Jest, Spectator, MockStore
- **E2E:** Playwright (already configured)

### Documentation
- [NestJS Testing Guide](https://docs.nestjs.com/fundamentals/testing)
- [Angular Testing Guide](https://angular.io/guide/testing)
- [Jest Matchers](https://jestjs.io/docs/expect)
- [Spectator Testing Library](https://github.com/ngneat/spectator)

---

**Created:** October 8, 2025
**Target Completion:** November 12, 2025 (5 weeks)
**Estimated Effort:** 200 hours (1 full-time developer for 5 weeks)
**Priority:** CRITICAL - Required before production release
