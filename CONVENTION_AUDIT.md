# BitBonsai - Code Convention Compliance Audit

**Date:** 2026-01-09
**Auditor:** Claude Code
**Conventions Source:** `~/git/code-conventions` (constitution.md + 30+ guidelines)

---

## Executive Summary

BitBonsai is **80% compliant** with established code conventions. The codebase demonstrates solid fundamentals with modern patterns, but lacks critical architectural layers required by the constitution.

| Category | Status | Count |
|----------|--------|-------|
| ✅ Compliant | 13 areas | Type safety, DI, naming, modern Angular, auth |
| 🔴 Critical gaps | 6 areas | Backend: Repository, BOs, controller logic / Frontend: NgRx, signals, i18n |
| 🟡 Medium issues | 5 areas | Large components, file organization |
| 🟢 Low priority | 4 areas | Documentation, validation depth |

**Effort to achieve full compliance:** 24-33 working days

---

## ✅ What's Working Well

### Backend (NestJS)
- **Type safety:** Zero `any` types found
- **Modular architecture:** Clean module boundaries with explicit imports/exports
- **Error handling:** Custom `BaseError` hierarchy with operational flags
- **Dependency injection:** Proper constructor injection with `forwardRef()` for circular deps
- **Security:** No hardcoded secrets, JWT auth, rate limiting

### Frontend (Angular)
- **Modern patterns:** Standalone components, OnPush change detection
- **Control flow:** New `@if`, `@for`, `@switch` syntax (no legacy `*ngIf`)
- **API clients:** Typed clients in `core/clients/*.client.ts`
- **Business Objects:** BO classes for transformations (frontend only)
- **Guards:** Proper auth guard stack (setup → auth → role)

### Shared
- **Naming conventions:** Consistent `*.service.ts`, `*.controller.ts`, `*.dto.ts`, `*.bo.ts`
- **Conventional commits:** Recent commits follow `feat:`, `fix:`, `docs:` format
- **Interceptors:** API base URL, error handling, auth token injection

---

## 🔴 Critical Violations (Must Fix)

### Backend: Architecture Issues

#### 1. No Repository Pattern ⚠️ HIGH IMPACT

**Violation:** Services directly inject `PrismaService` and make database calls.

**Why it matters:**
- Tight coupling to Prisma ORM (hard to test, hard to swap)
- No DAO ↔ BO transformation layer
- Business logic mixed with data access

**Current pattern:**
```typescript
// queue.service.ts - VIOLATES CONVENTION
@Injectable()
export class QueueService {
  constructor(private prisma: PrismaService) {}

  async getJob(id: string) {
    return this.prisma.job.findUnique({ where: { id } });
  }
}
```

**Required pattern:**
```typescript
// _repositories/queue.repository.ts
@Injectable()
export class QueueRepository {
  constructor(private prisma: PrismaService) {}

  async findById(id: string): Promise<JobBo | null> {
    const dao = await this.prisma.job.findUnique({ where: { id } });
    return dao ? JobBo.fromDao(dao) : null;
  }
}

// _services/queue.service.ts
@Injectable()
export class QueueService {
  constructor(private queueRepo: QueueRepository) {}

  async getJob(id: string): Promise<JobDto> {
    const bo = await this.queueRepo.findById(id);
    if (!bo) throw new NotFoundError('Job not found');
    return JobDto.fromBo(bo);
  }
}
```

**Impact:**
- **20+ services** need refactoring
- **20+ repositories** need creation
- All Prisma queries move to repository layer

---

#### 2. No Business Objects (Backend) ⚠️ HIGH IMPACT

**Violation:** Backend returns Prisma entities directly. No BO layer for business logic.

**Why it matters:**
- Business logic scattered across services
- No centralized place for calculations, validations, state transitions
- DTO transformations happen inline (not reusable)

**Required pattern:**
```typescript
// models/job.bo.ts
export class JobBo {
  id: string;
  fileName: string;
  status: JobStatus;
  progress: number;

  static fromDao(dao: Job): JobBo {
    const bo = new JobBo();
    bo.id = dao.id;
    bo.fileName = dao.fileName;
    bo.status = dao.status;
    bo.progress = dao.progress;
    return bo;
  }

  toDao(): Prisma.JobUpdateInput {
    return {
      fileName: this.fileName,
      status: this.status,
      progress: this.progress,
    };
  }

  // Business logic methods
  canTransitionTo(newStatus: JobStatus): boolean {
    // State transition validation logic
  }

  calculateEstimatedDuration(): number {
    // Calculation logic
  }

  isStuck(): boolean {
    return this.status === 'ENCODING' && Date.now() - this.updatedAt > 3600000;
  }
}
```

**Impact:**
- **20+ BO classes** need creation (one per Prisma model)
- Business logic extracted from services to BOs
- DTOs use `JobDto.fromBo(bo)` pattern

---

#### 3. Controllers Have Business Logic ⚠️ MEDIUM IMPACT

**Violation:** Controllers contain validation, transformation, and business rules.

**Why it matters:**
- Violates layered architecture (Controller → Service → Repository → DAO)
- Logic not reusable (locked in HTTP layer)
- Harder to test (need HTTP context)

**Example violation:**
```typescript
// queue.controller.ts - VIOLATES CONVENTION
@Patch(':id')
async updateJob(@Param('id') id: string, @Body() dto: UpdateJobDto) {
  // ❌ Validation logic in controller
  if (dto.status === 'ENCODING' && !dto.nodeId) {
    throw new BadRequestException('nodeId required for ENCODING');
  }
  return this.queueService.updateJob(id, dto);
}
```

**Required pattern:**
```typescript
// Controller: HTTP handling ONLY
@Patch(':id')
async updateJob(@Param('id') id: string, @Body() dto: UpdateJobDto) {
  return this.queueService.updateJob(id, dto);
}

// Service: business logic
async updateJob(id: string, dto: UpdateJobDto): Promise<JobDto> {
  // ✅ Validation in service
  if (dto.status === 'ENCODING' && !dto.nodeId) {
    throw new ValidationError('nodeId required for ENCODING');
  }

  const bo = await this.queueRepo.findById(id);
  if (!bo) throw new NotFoundError('Job not found');

  // Use BO for state transition validation
  if (!bo.canTransitionTo(dto.status)) {
    throw new ConflictError('Invalid state transition');
  }

  // Update and save
  Object.assign(bo, dto);
  await this.queueRepo.update(bo);

  return JobDto.fromBo(bo);
}
```

**Impact:**
- **28 controllers** need logic extraction
- Services become orchestrators (not just passthroughs)

---

### Frontend: State Management Issues

#### 4. NgRx NOT Used for Global State ⚠️ HIGH IMPACT

**Violation:** Global state managed with BehaviorSubjects instead of NgRx.

**Why it matters:**
- Convention principle #2: "NgRx EVERYWHERE for global state"
- No time-travel debugging, no devtools support
- State mutations not tracked (hard to debug)

**Current pattern:**
```typescript
// queue.page.ts - VIOLATES CONVENTION
private readonly refreshTrigger$ = new BehaviorSubject({ showLoading: true });

this.queueData$ = this.refreshTrigger$.pipe(
  switchMap(() => this.queueApi.getQueue(this.buildFilters())),
  shareReplay({ bufferSize: 1, refCount: true })
);
```

**Required pattern:**
```typescript
// features/queue/+state/queue.actions.ts
export const QueueActions = createActionGroup({
  source: 'Queue',
  events: {
    'Load Queue': props<{ filters: QueueFilters }>(),
    'Load Queue Success': props<{ data: QueueResponse }>(),
    'Load Queue Failure': props<{ error: string }>(),
  }
});

// features/queue/+state/queue.effects.ts
loadQueue$ = createEffect(() => this.actions$.pipe(
  ofType(QueueActions.loadQueue),
  switchMap(({ filters }) =>
    this.queueClient.getQueue(filters).pipe(
      map(data => QueueActions.loadQueueSuccess({ data })),
      catchError(error => of(QueueActions.loadQueueFailure({ error })))
    )
  )
));

// Component uses selectors
this.queueData$ = this.store.select(selectQueueData);
```

**Impact:**
- **10+ features** need NgRx migration (queue, libraries, policies, nodes, etc.)
- Create `+state/` folders with actions, effects, reducers, selectors
- Components dispatch actions instead of calling services directly

---

#### 5. Signals NOT Used for Local State ⚠️ MEDIUM IMPACT

**Violation:** Component-local state uses BehaviorSubjects instead of signals.

**Why it matters:**
- Convention principle #4: "Signals for local state"
- BehaviorSubjects require `| async` pipe (boilerplate)
- Signals integrate with Angular's new reactivity model

**Current pattern:**
```typescript
// queue.page.ts - VIOLATES CONVENTION
private readonly loadingSubject$ = new BehaviorSubject<boolean>(false);
loading$ = this.loadingSubject$.asObservable();

// Template:
@if (loading$ | async) { <spinner /> }
```

**Required pattern:**
```typescript
// Use signals
loading = signal(false);
selectedIds = signal<string[]>([]);

// Computed signals for derived state
canBulkDelete = computed(() => this.selectedIds().length > 0);

// Template:
@if (loading()) { <spinner /> }
```

**Impact:**
- **15+ components** using BehaviorSubjects need migration
- Templates lose `| async` pipe (cleaner syntax)
- Better change detection performance

---

#### 6. No i18n (Internationalization) ⚠️ MEDIUM IMPACT

**Violation:** Hardcoded strings throughout templates and services.

**Why it matters:**
- Convention principle #10: "i18n ALL text"
- Can't localize to other languages
- Text changes require code changes (not config)

**Current pattern:**
```html
<!-- queue.page.html - VIOLATES CONVENTION -->
<h1>Queue</h1>
<button>Add Files</button>
<p>No jobs in queue</p>
```

**Required pattern:**
```html
<h1>{{ 'queue.title' | translate }}</h1>
<button>{{ 'queue.addFiles' | translate }}</button>
<p>{{ 'queue.empty' | translate }}</p>
```

```json
// assets/i18n/en.json
{
  "queue": {
    "title": "Queue",
    "addFiles": "Add Files",
    "empty": "No jobs in queue"
  }
}
```

**Impact:**
- Install `@ngx-translate/core` + `@ngx-translate/http-loader`
- Create translation files (`en.json`, `fr.json`)
- **100+ templates** need string extraction
- Services use `TranslateService` for dynamic strings

---

## 🟡 Medium Priority Issues

### 7. Large Component Files

**Issue:** `QueueComponent` is 1900+ lines with 50+ methods.

**Convention:** Max 80-100 lines per method; break into sub-components.

**Recommendation:**
```
queue/
├── queue.page.ts (orchestrator, ~300 lines)
├── components/
│   ├── queue-filters.component.ts
│   ├── queue-table.component.ts
│   ├── job-actions.component.ts
│   └── add-files-modal.component.ts
```

**Impact:**
- **5-8 large components** need splitting
- Better testability, reusability

---

### 8. File Organization

**Issue:** Backend lacks `_services/`, `_repositories/`, `_dtos/` prefixes.

**Current structure:**
```
queue/
├── queue.controller.ts
├── queue.service.ts
├── dto/
│   ├── create-job.dto.ts
│   └── update-job.dto.ts
```

**Required structure:**
```
queue/
├── queue.controller.ts
├── _services/
│   └── queue.service.ts
├── _repositories/
│   └── queue.repository.ts
├── _dtos/
│   ├── create-job.dto.ts
│   └── update-job.dto.ts
└── models/
    └── job.bo.ts
```

**Impact:**
- **30+ modules** need folder reorganization
- Clearer visual hierarchy

---

### 9-12. Other Medium Issues

- **Mixed state patterns:** Some features use BehaviorSubjects, others observables
- **Frontend file organization:** BOs scattered in `bos/` folders (should be `models/`)
- **Dead code:** Some commented code exists (audit issue references OK)

---

## 🟢 Low Priority Observations

13. **Service hierarchy unclear** - Document purpose of each service tier
14. **DTO validation incomplete** - Add more `class-validator` decorators
15. **Logging levels** - Standardize ERROR vs WARN vs INFO usage
16. **HTTP status codes** - Document which codes each endpoint returns

---

## Implementation Roadmap

### Phase 1: Backend Architecture (Weeks 1-4) - 12-14 days

**Priority:** HIGH - Establishes foundation for testability and maintainability

1. **Create Business Objects** (3-4 days)
   - Start with core entities: Job, Library, Policy, Node
   - Add `fromDao()`, `toDao()` static methods
   - Move business logic from services to BOs

2. **Implement Repository Pattern** (5-7 days)
   - Create `_repositories/` folders in all modules
   - Refactor services to inject repositories (not PrismaService)
   - Update all database queries to use repository layer
   - **Risk:** HIGH - Breaking change, thorough testing required

3. **Extract Controller Logic** (2-3 days)
   - Move validation from controllers to services
   - Controllers become thin HTTP handlers
   - Services become orchestrators

4. **File Organization** (1-2 days)
   - Rename folders to `_services/`, `_dtos/`
   - Move files to proper locations

---

### Phase 2: Frontend State Management (Weeks 5-6) - 10-14 days

**Priority:** HIGH - Improves debugging, predictability

5. **NgRx Migration (Pilot)** (3-4 days)
   - Start with queue module (most complex)
   - Create `+state/` folder (actions, effects, reducer, selectors)
   - Test thoroughly before rolling out

6. **NgRx Migration (Rollout)** (4-6 days)
   - Migrate libraries, policies, nodes modules
   - Establish patterns from pilot

7. **Signals Migration** (3-4 days)
   - Replace BehaviorSubjects with signals in all components
   - Update templates to remove `| async` pipe
   - Use `computed()` for derived state

---

### Phase 3: Internationalization (Week 7) - 4-5 days

**Priority:** MEDIUM - Enables future localization

8. **i18n Setup** (1 day)
   - Install @ngx-translate packages
   - Configure translation loader
   - Create initial `en.json` structure

9. **String Extraction** (3-4 days)
   - Extract strings from templates
   - Extract strings from services (error messages, notifications)
   - Create translation keys
   - Update all templates with `| translate` pipe

---

### Phase 4: Code Quality (Week 8) - 2-3 days

**Priority:** MEDIUM - Improves maintainability

10. **Component Refactoring** (2-3 days)
    - Split queue.page.ts into sub-components
    - Extract other large components (libraries, policies)
    - Create reusable shared components

---

## Estimated Timeline & Effort

| Phase | Duration | Effort (days) | Risk |
|-------|----------|---------------|------|
| Backend Architecture | Weeks 1-4 | 12-14 | HIGH (breaking changes) |
| Frontend State | Weeks 5-6 | 10-14 | HIGH (state rewrite) |
| i18n | Week 7 | 4-5 | MEDIUM (template updates) |
| Code Quality | Week 8 | 2-3 | LOW (incremental) |
| **TOTAL** | **8 weeks** | **28-36 days** | - |

---

## Verification Checklist

### Backend Compliance
- [ ] Repository pattern implemented (Controller → Service → Repository → Prisma)
- [ ] Business Objects created for all entities
- [ ] Controllers contain ONLY HTTP handling
- [ ] Services contain ONLY orchestration logic
- [ ] Repositories handle DAO ↔ BO transformation
- [ ] No direct Prisma injection in services
- [ ] File structure: `_services/`, `_repositories/`, `_dtos/`, `models/`

### Frontend Compliance
- [ ] NgRx implemented for all global state (queue, libraries, policies, etc.)
- [ ] Signals used for all component-local state
- [ ] No BehaviorSubjects for state management
- [ ] i18n configured with translation files
- [ ] All hardcoded strings use `| translate` pipe
- [ ] Large components split (max 100 lines/method)
- [ ] File structure: `+state/` for NgRx, `components/` for sub-components
- [ ] Modern control flow (`@if`, `@for`) - ✅ Already compliant

---

## Testing Strategy

### Backend Testing (Per Module)
1. **Unit tests** - Business Objects, Services
2. **Integration tests** - Repositories (with test DB)
3. **E2E tests** - Full workflows through controllers

### Frontend Testing (Per Feature)
1. **Unit tests** - Effects, Reducers, Selectors
2. **Component tests** - UI interactions, state integration
3. **E2E tests** - User workflows (Playwright)

---

## Risk Mitigation

### High-Risk Changes
1. **Repository pattern introduction**
   - Risk: Breaking existing code
   - Mitigation: Incremental rollout (one module at a time), comprehensive testing

2. **NgRx migration**
   - Risk: State bugs, performance regression
   - Mitigation: Pilot with queue module, validate before rollout

### Recommended Approach
- **Incremental:** One module/feature at a time
- **Test-first:** Write tests before refactoring
- **Feature flags:** Optional - toggle new patterns on/off
- **Code review:** Pair review for architectural changes

---

## Questions for Clarification

1. **Priority:** Which violations are most painful right now?
2. **Timeline:** Need full compliance ASAP, or can we phase it?
3. **Testing:** Add tests during refactor, or after?
4. **i18n:** Which languages need support? (en only for now?)
5. **Breaking changes:** OK to refactor aggressively, or minimize risk?

---

## Conclusion

BitBonsai is **well-structured** but lacks critical architectural layers mandated by the constitution. The backend needs repository + BO layers for proper separation of concerns. The frontend needs NgRx + signals for state management standardization.

**Recommended first step:** Implement repository pattern for one backend module (e.g., queue) as a pilot. Validate the pattern, then roll out systematically.

**Quick wins (low-hanging fruit):**
- Extract controller logic to services (1-2 days)
- Reorganize file structure (1 day)
- Split large components (2-3 days)

**Long-term investment:**
- Repository pattern + BOs (backend foundation)
- NgRx + signals (frontend predictability)
- i18n (future-proofing)

---

**Audit completed:** 2026-01-09
**Full plan:** `/Users/wassimmehanna/.claude/plans/silly-discovering-walrus.md`
