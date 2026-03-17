# BitBonsai Agents

This directory contains Claude Code agents for the BitBonsai project - a mix of shared agents (symlinked from `~/git/code-conventions/`) and project-specific agents.

## Agent Organization

### Project-Specific Agents (BitBonsai)
- **playwright-test-planner.md** - E2E test scenario generation
- **playwright-test-generator.md** - Convert scenarios to Playwright tests
- **playwright-test-healer.md** - Auto-fix broken E2E tests

### Shared Agents (symlinked from ~/git/code-conventions/.claude/agents/)
- **debugger.md** - Bug diagnosis and fixing
- **fullstack-feature.md** - NestJS + Angular 20 features
- **pr-reviewer.md** - Code review and compliance
- **test-engineer.md** - Comprehensive testing
- **performance-optimizer.md** - Performance optimization
- **security-auditor.md** - Security scanning
- **documentation-writer.md** - Documentation generation

## Quick Reference

| Task Type | Agent | Example |
|-----------|-------|---------|
| Implement Feature | fullstack-feature | `/task Use fullstack-feature to add job scheduling` |
| Write Tests | test-engineer | `/task Use test-engineer to test NodesService` |
| Fix Bug | debugger | `/task Use debugger to fix 500 error` |
| Review PR | pr-reviewer | `/task Use pr-reviewer to review PR #42` |
| Generate E2E Tests | playwright-test-planner | `/task Use playwright-test-planner for library management` |
| Convert to Code | playwright-test-generator | `/task Use playwright-test-generator with test plan` |
| Fix Broken Tests | playwright-test-healer | `/task Use playwright-test-healer for failing tests` |
| Optimize Performance | performance-optimizer | `/task Use performance-optimizer for slow queries` |
| Security Audit | security-auditor | `/task Use security-auditor to scan for vulnerabilities` |
| Write Docs | documentation-writer | `/task Use documentation-writer for API docs` |

## Available Agents

### Core Workflow Agents

#### fullstack-feature.md
**Purpose**: Implement complete features across backend (NestJS) and frontend (Angular 20)

**Responsibilities**:
- Backend API development with Swagger docs
- Frontend implementation with NgRx state management
- Ensuring API DTOs match frontend models
- PRD maintenance (mandatory before/after feature work)

**Example**:
```bash
/task Use fullstack-feature to implement library filtering with backend API and frontend UI
```

#### test-engineer.md
**Purpose**: Write comprehensive tests across all layers

**Responsibilities**:
- Unit tests (Jest/Jasmine)
- Integration tests (Prisma + database)
- Backend E2E tests (Supertest)
- Knows when to delegate to Playwright agents

**Example**:
```bash
/task Use test-engineer to add unit and integration tests for LibrariesService
```

#### debugger.md
**Purpose**: Systematically diagnose and fix bugs

**Responsibilities**:
- Error analysis and root cause identification
- Bug fixes with regression tests
- Linter error resolution workflow
- Git bisect for regression identification

**Example**:
```bash
/task Use debugger to fix the undefined error in node pairing
```

#### pr-reviewer.md
**Purpose**: Comprehensive code review

**Responsibilities**:
- Guideline compliance verification
- Security vulnerability detection
- Architecture pattern checking
- PRD compliance check (mandatory for features)

**Example**:
```bash
/task Use pr-reviewer to review the library management PR
```

### Specialized Agents

#### performance-optimizer.md
**Purpose**: Profile and optimize performance bottlenecks

**Responsibilities**:
- Frontend: bundle size, change detection, lazy loading
- Backend: slow queries, N+1 problems, caching
- Database: indexes, query optimization
- Before/after benchmarking

**Example**:
```bash
/task Use performance-optimizer to improve library scanning performance
```

#### security-auditor.md
**Purpose**: Security vulnerability scanning

**Responsibilities**:
- OWASP Top 10 compliance
- Dependency vulnerabilities (npm audit)
- Authentication/authorization checks
- Secret detection in code

**Example**:
```bash
/task Use security-auditor to scan for security vulnerabilities
```

#### documentation-writer.md
**Purpose**: Generate comprehensive documentation

**Responsibilities**:
- API documentation with examples
- Architecture diagrams (Mermaid)
- JSDoc/TSDoc comments
- README and setup guides

**Example**:
```bash
/task Use documentation-writer to document the queue management API
```

### Playwright E2E Agents (BitBonsai-Specific)

#### playwright-test-planner.md
**Purpose**: Generate E2E test scenarios from requirements

**Workflow**:
1. Read PRD and analyze feature
2. Generate test scenarios (happy path + edge cases)
3. Output structured test plan

**Example**:
```bash
/task Use playwright-test-planner to create test plan for library management
```

#### playwright-test-generator.md
**Purpose**: Convert test plans to Playwright code

**Workflow**:
1. Read test plan from planner
2. Generate Playwright test files
3. Use page object pattern
4. Add data-testid attributes to components

**Example**:
```bash
/task Use playwright-test-generator to convert the library test plan to code
```

#### playwright-test-healer.md
**Purpose**: Auto-fix broken E2E tests

**Workflow**:
1. Analyze test failure logs
2. Identify root cause (selector change, timing, etc.)
3. Update test code or page objects
4. Verify fix with re-run

**Example**:
```bash
/task Use playwright-test-healer to fix failing node pairing tests
```

## Development Workflow

### Feature Development
```bash
# 1. Plan feature and update PRD
/task Use fullstack-feature to implement job filtering

# 2. Add comprehensive tests
/task Use test-engineer to add unit/integration tests

# 3. Add E2E tests
/task Use playwright-test-planner to create E2E test plan
/task Use playwright-test-generator to convert plan to code

# 4. Review before merge
/task Use pr-reviewer to review the implementation

# 5. Debug if needed
/task Use debugger to fix any issues found
```

### Bug Fixing
```bash
# 1. Diagnose and fix
/task Use debugger to fix the 500 error in node registration

# 2. Verify tests pass
npm test

# 3. Optional: Security check if bug-related
/task Use security-auditor to check for related vulnerabilities
```

### Performance Optimization
```bash
# 1. Profile and optimize
/task Use performance-optimizer to improve library scan performance

# 2. Verify with tests
npm test

# 3. Measure improvements
# Compare before/after metrics
```

## Guidelines

All agents follow conventions in `~/git/code-conventions/`:
- `angular-guidelines.md` - Frontend (Angular 20, NgRx)
- `nestjs-guidelines.md` - Backend (NestJS, Prisma)
- `api-design-guidelines.md` - REST API patterns
- `testing-guidelines.md` - Test strategies
- `git-conventions.md` - Commit messages

## Project Context (Auto-Detected)

Agents automatically detect BitBonsai context:
- **Stack**: Angular 20 + NgRx (frontend), NestJS + Prisma (backend)
- **Architecture**: Nx monorepo, domain-scoped features
- **Testing**: Playwright E2E + Jest/Jasmine unit tests
- **PRD**: `apps/frontend/e2e/specs/requirements/bitbonsai-application.md`

**Quality Gates**:
- Linter: `npm run check` (0 errors)
- Tests: `npm test` (all passing, 95%+ coverage)
- Build: `npm run build` (no compilation errors)

## Shared Agent Library

Shared agents are symlinked from `~/git/code-conventions/.claude/agents/`. This allows:
- ✅ Consistent agent behavior across projects
- ✅ Single source of truth for updates
- ✅ Project-specific customization via local agents

To update shared agents:
```bash
cd ~/git/code-conventions/.claude/agents
# Edit agent files
git commit -m "Update agent X"
```

Changes automatically available to all projects using symlinks.

## Notes

- Agents auto-detect project context and adapt behavior
- PRD maintenance is mandatory for feature work (fullstack-feature, pr-reviewer)
- test-engineer delegates to Playwright agents for E2E test generation
- All agents enforce quality gates (linter, tests, build)
