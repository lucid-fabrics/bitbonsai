# Testing Guidelines for BitBonsai

> **Last Updated:** October 1, 2025
> **Project:** BitBonsai - Intelligent Media Encoding Platform

## Table of Contents

1. [Testing Philosophy](#testing-philosophy)
2. [Testing Pyramid](#testing-pyramid)
3. [Backend Testing (NestJS + Jest)](#backend-testing-nestjs--jest)
4. [Frontend Testing (Angular + Jasmine/Karma)](#frontend-testing-angular--jasminkarma)
5. [E2E Testing (Playwright - Future)](#e2e-testing-playwright---future)
6. [Coverage Requirements](#coverage-requirements)
7. [Running Tests](#running-tests)
8. [Common Patterns](#common-patterns)
9. [Testing Checklist](#testing-checklist)
10. [Troubleshooting](#troubleshooting)

---

## Testing Philosophy

BitBonsai follows these core testing principles:

- **Test Behavior, Not Implementation**: Tests should validate what the code does, not how it does it
- **Fast Feedback Loop**: Unit tests should run in milliseconds, integration tests in seconds
- **Isolation**: Each test should be independent and not rely on external state
- **Readability**: Tests are documentation - write them clearly
- **Coverage with Purpose**: Aim for 80%+ coverage, but focus on critical paths
- **Mock External Dependencies**: Database, file system, child processes, external APIs

### Critical Paths Requiring 100% Coverage

- **Authentication & Authorization**: License validation, key generation
- **Payment Processing**: License creation, tier upgrades
- **Media Encoding**: FFmpeg command building, progress tracking, error handling
- **Data Integrity**: File operations, atomic replacements, rollback logic

---

## Testing Pyramid

```
        /\
       /  \
      / E2E \         <- Few (Playwright) - Full user journeys
     /______\
    /        \
   /Integration\     <- Some (Jest) - API endpoints, database interactions
  /____________\
 /              \
/   Unit Tests   \   <- Many (Jest/Jasmine) - Services, utilities, pure functions
/________________\
```

### Distribution Guidelines

- **Unit Tests**: 70% - Fast, isolated, cover all business logic
- **Integration Tests**: 25% - API contracts, database queries, service interactions
- **E2E Tests**: 5% - Critical user flows, smoke tests

---

## Backend Testing (NestJS + Jest)

### Configuration

**Location**: `apps/backend/jest.config.js`

```javascript
module.exports = {
  displayName: 'backend',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/backend',
};
```

### Basic Test Structure

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { YourService } from './your.service';
import { DependencyService } from '../dependency/dependency.service';

describe('YourService', () => {
  let service: YourService;
  let dependencyService: DependencyService;

  // Mock dependencies
  const mockDependencyService = {
    someMethod: jest.fn(),
    anotherMethod: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YourService,
        {
          provide: DependencyService,
          useValue: mockDependencyService,
        },
      ],
    }).compile();

    service = module.get<YourService>(YourService);
    dependencyService = module.get<DependencyService>(DependencyService);

    // Clear mocks between tests
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Add your tests here
});
```

### Testing Services with PrismaService

**Pattern**: Always mock PrismaService for unit tests to avoid database dependencies.

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseService } from './license.service';

describe('LicenseService', () => {
  let service: LicenseService;
  let prisma: PrismaService;

  const mockPrismaService = {
    license: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<LicenseService>(LicenseService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('validateLicense', () => {
    it('should return valid license details when license is active', async () => {
      const mockLicense = {
        id: 'license-123',
        tier: 'FREE',
        status: 'ACTIVE',
        validUntil: null,
        maxNodes: 1,
        features: {},
        _count: { nodes: 0 },
      };

      mockPrismaService.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.validateLicense('FRE-test123');

      expect(result).toMatchObject({
        id: 'license-123',
        status: 'ACTIVE',
      });
      expect(mockPrismaService.license.findUnique).toHaveBeenCalledWith({
        where: { key: 'FRE-test123' },
        select: expect.any(Object),
      });
    });

    it('should throw NotFoundException when license does not exist', async () => {
      mockPrismaService.license.findUnique.mockResolvedValue(null);

      await expect(service.validateLicense('INVALID-KEY')).rejects.toThrow(
        'License not found'
      );
    });
  });
});
```

### Testing Services with EventEmitter2

**Pattern**: Mock EventEmitter2 to test event emissions without side effects.

```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { EncodingService } from './encoding.service';

describe('EncodingService', () => {
  let service: EncodingService;
  let eventEmitter: EventEmitter2;

  const mockEventEmitter = {
    emit: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncodingService,
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<EncodingService>(EncodingService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    jest.clearAllMocks();
  });

  it('should emit progress event during encoding', async () => {
    await service.startEncoding('job-123');

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'encoding.progress',
      expect.objectContaining({
        jobId: 'job-123',
        progress: expect.any(Number),
      })
    );
  });
});
```

### Testing Controllers

**Pattern**: Mock the service layer and test HTTP layer logic only.

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { LibrariesController } from './libraries.controller';
import { LibrariesService } from './libraries.service';

describe('LibrariesController', () => {
  let controller: LibrariesController;
  let service: LibrariesService;

  const mockLibrariesService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    scan: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LibrariesController],
      providers: [
        {
          provide: LibrariesService,
          useValue: mockLibrariesService,
        },
      ],
    }).compile();

    controller = module.get<LibrariesController>(LibrariesController);
    service = module.get<LibrariesService>(LibrariesService);

    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all libraries', async () => {
      const mockLibraries = [
        { id: 'lib-1', name: 'Movies' },
        { id: 'lib-2', name: 'TV Shows' },
      ];

      mockLibrariesService.findAll.mockResolvedValue(mockLibraries);

      const result = await controller.findAll();

      expect(result).toEqual(mockLibraries);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a library', async () => {
      const createDto = {
        name: 'Movies',
        path: '/media/movies',
        nodeId: 'node-1',
      };
      const mockLibrary = { id: 'lib-1', ...createDto };

      mockLibrariesService.create.mockResolvedValue(mockLibrary);

      const result = await controller.create(createDto);

      expect(result).toEqual(mockLibrary);
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });
});
```

### Testing Child Processes (FFmpeg)

**Pattern**: Mock `child_process.spawn` and simulate process events.

```typescript
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Test, type TestingModule } from '@nestjs/testing';
import { FfmpegService } from './ffmpeg.service';

// Mock child_process module
jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

describe('FfmpegService', () => {
  let service: FfmpegService;
  let mockSpawn: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();

    const childProcess = await import('node:child_process');
    mockSpawn = childProcess.spawn as jest.Mock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [FfmpegService],
    }).compile();

    service = module.get<FfmpegService>(FfmpegService);
  });

  it('should successfully encode file', async () => {
    // Create mock process with stderr stream
    const stderrEmitter = new EventEmitter();
    const mockProcess = new EventEmitter() as ChildProcess;
    (mockProcess as any).stderr = stderrEmitter;
    mockSpawn.mockReturnValue(mockProcess);

    const encodePromise = service.encodeFile(mockJob, mockPolicy);

    // Simulate progress updates
    setTimeout(() => {
      stderrEmitter.emit('data', Buffer.from('frame= 1000 fps= 50.0\n'));
    }, 10);

    // Simulate successful completion
    setTimeout(() => {
      mockProcess.emit('close', 0);
    }, 20);

    await encodePromise;

    expect(mockSpawn).toHaveBeenCalledWith('ffmpeg', expect.any(Array));
  });

  it('should handle encoding failure', async () => {
    const stderrEmitter = new EventEmitter();
    const mockProcess = new EventEmitter() as ChildProcess;
    (mockProcess as any).stderr = stderrEmitter;
    mockSpawn.mockReturnValue(mockProcess);

    const encodePromise = service.encodeFile(mockJob, mockPolicy);

    // Simulate failure
    setTimeout(() => {
      mockProcess.emit('close', 1);
    }, 10);

    await expect(encodePromise).rejects.toThrow('ffmpeg exited with code 1');
  });
});
```

### Testing File System Operations

**Pattern**: Mock `fs` module to avoid real file system operations.

```typescript
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  promises: {
    stat: jest.fn(),
    rename: jest.fn(),
    unlink: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
}));

describe('FileService', () => {
  let mockFs: {
    existsSync: jest.Mock;
    stat: jest.Mock;
    rename: jest.Mock;
  };

  beforeEach(async () => {
    const fs = await import('node:fs');
    mockFs = {
      existsSync: fs.existsSync as jest.Mock,
      stat: fs.promises.stat as jest.Mock,
      rename: fs.promises.rename as jest.Mock,
    };

    mockFs.existsSync.mockReturnValue(true);
    mockFs.stat.mockResolvedValue({ size: 1000000 } as any);
  });

  it('should check if file exists', async () => {
    mockFs.existsSync.mockReturnValue(true);

    const exists = service.fileExists('/path/to/file.mp4');

    expect(exists).toBe(true);
    expect(mockFs.existsSync).toHaveBeenCalledWith('/path/to/file.mp4');
  });
});
```

### Testing Async Operations

**Best Practices:**

```typescript
// ✅ GOOD - Use async/await
it('should complete async operation', async () => {
  const result = await service.asyncMethod();
  expect(result).toBe('success');
});

// ✅ GOOD - Test Promise rejection
it('should reject with error', async () => {
  await expect(service.failingMethod()).rejects.toThrow('Error message');
});

// ❌ BAD - Missing await
it('should complete async operation', () => {
  service.asyncMethod(); // Test will pass even if it fails!
});

// ✅ GOOD - Use done callback for complex async
it('should emit event', (done) => {
  service.on('event', (data) => {
    expect(data).toBe('value');
    done();
  });
  service.triggerEvent();
});
```

### Testing Error Cases

**Pattern**: Test both success and failure paths.

```typescript
describe('validateInput', () => {
  it('should validate correct input', () => {
    const result = service.validateInput({ name: 'Test', value: 100 });
    expect(result.isValid).toBe(true);
  });

  it('should reject missing name', () => {
    expect(() => service.validateInput({ value: 100 })).toThrow(
      'Name is required'
    );
  });

  it('should reject negative value', () => {
    expect(() => service.validateInput({ name: 'Test', value: -1 })).toThrow(
      'Value must be positive'
    );
  });

  it('should reject non-numeric value', () => {
    expect(() => service.validateInput({ name: 'Test', value: 'abc' })).toThrow(
      'Value must be a number'
    );
  });
});
```

### Testing BigInt Values

**Pattern**: Convert BigInt to string for comparisons and assertions.

```typescript
it('should handle BigInt values correctly', async () => {
  const mockMetric = {
    totalSavedBytes: BigInt(5368709120), // 5 GB
  };

  mockPrismaService.metric.findUnique.mockResolvedValue(mockMetric);

  const result = await service.getMetric('metric-1');

  // Convert to string for assertion
  expect(result.totalSavedBytes).toBe('5368709120');

  // Or compare numerically
  expect(Number(result.totalSavedBytes)).toBeGreaterThan(5000000000);
});
```

---

## Frontend Testing (Angular + Jasmine/Karma)

### Configuration

**Location**: `apps/frontend/karma.conf.js` (to be created)

```javascript
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    client: {
      clearContext: false,
      jasmine: {
        random: false,
      },
    },
    coverageReporter: {
      dir: require('path').join(__dirname, '../../coverage/apps/frontend'),
      reporters: ['html', 'lcovonly', 'text-summary'],
      check: {
        global: {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
      },
    },
    reporters: ['progress', 'coverage'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    browsers: ['ChromeHeadless'],
    singleRun: false,
  });
};
```

### Testing Angular Components

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LibraryListComponent } from './library-list.component';
import { LibraryService } from '../../services/library.service';
import { of } from 'rxjs';

describe('LibraryListComponent', () => {
  let component: LibraryListComponent;
  let fixture: ComponentFixture<LibraryListComponent>;
  let mockLibraryService: jasmine.SpyObj<LibraryService>;

  beforeEach(async () => {
    mockLibraryService = jasmine.createSpyObj('LibraryService', [
      'getLibraries',
      'deleteLibrary',
    ]);

    await TestBed.configureTestingModule({
      declarations: [LibraryListComponent],
      providers: [{ provide: LibraryService, useValue: mockLibraryService }],
    }).compileComponents();

    fixture = TestBed.createComponent(LibraryListComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load libraries on init', () => {
    const mockLibraries = [
      { id: '1', name: 'Movies' },
      { id: '2', name: 'TV Shows' },
    ];
    mockLibraryService.getLibraries.and.returnValue(of(mockLibraries));

    component.ngOnInit();

    expect(component.libraries).toEqual(mockLibraries);
    expect(mockLibraryService.getLibraries).toHaveBeenCalled();
  });
});
```

### Testing Angular Services

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { LibraryService } from './library.service';

describe('LibraryService', () => {
  let service: LibraryService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [LibraryService],
    });

    service = TestBed.inject(LibraryService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should fetch libraries', () => {
    const mockLibraries = [{ id: '1', name: 'Movies' }];

    service.getLibraries().subscribe((libraries) => {
      expect(libraries).toEqual(mockLibraries);
    });

    const req = httpMock.expectOne('/api/libraries');
    expect(req.request.method).toBe('GET');
    req.flush(mockLibraries);
  });
});
```

---

## E2E Testing (Playwright - Future)

### Configuration

**Location**: `playwright.config.ts` (to be created)

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
  },
});
```

### E2E Test Example

```typescript
import { test, expect } from '@playwright/test';

test.describe('Library Management', () => {
  test('should create a new library', async ({ page }) => {
    await page.goto('/libraries');
    await page.click('button:has-text("Add Library")');

    await page.fill('input[name="name"]', 'Test Library');
    await page.fill('input[name="path"]', '/media/test');
    await page.selectOption('select[name="mediaType"]', 'MOVIE');

    await page.click('button:has-text("Create")');

    await expect(page.locator('text=Test Library')).toBeVisible();
  });
});
```

---

## Coverage Requirements

### Overall Targets

- **Minimum**: 80% line coverage across all projects
- **Goal**: 85%+ line coverage
- **Critical Paths**: 100% coverage (auth, payments, encoding)

### Coverage by File Type

| File Type | Target | Priority |
|-----------|--------|----------|
| Services | 90% | High |
| Controllers | 85% | High |
| DTOs/Validators | 80% | Medium |
| Utilities | 90% | High |
| Guards | 100% | Critical |
| Pipes | 85% | Medium |
| Components | 75% | Medium |
| Directives | 80% | Medium |

### Critical Paths (100% Required)

1. **License Management**
   - License validation
   - Key generation
   - Tier upgrades
   - Feature flag checks

2. **Media Encoding**
   - FFmpeg command building
   - Progress parsing
   - Error handling
   - File operations

3. **Queue Management**
   - Job creation
   - Job state transitions
   - Cancellation logic
   - Priority handling

4. **Data Integrity**
   - Atomic file replacement
   - Rollback on failure
   - Verification logic

### Checking Coverage

```bash
# Generate coverage report
nx test backend --coverage

# View HTML report
open coverage/apps/backend/index.html

# Check coverage thresholds
nx test backend --coverage --coverageThreshold='{"global":{"branches":80,"functions":80,"lines":80,"statements":80}}'
```

---

## Running Tests

### Local Development

```bash
# Run all backend tests
nx test backend

# Run tests in watch mode
nx test backend --watch

# Run specific test file
nx test backend --testFile=license.service.spec.ts

# Run tests matching pattern
nx test backend --testNamePattern="validateLicense"

# Run with coverage
nx test backend --coverage

# Run frontend tests
nx test frontend

# Run all tests
nx run-many --target=test --all
```

### Debugging Tests

#### VS Code Configuration

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Jest Tests",
      "type": "node",
      "request": "launch",
      "runtimeArgs": [
        "--inspect-brk",
        "${workspaceRoot}/node_modules/.bin/jest",
        "--runInBand",
        "--no-cache"
      ],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

#### WebStorm Configuration

1. Right-click on test file → Debug 'test-name'
2. Or create Run Configuration:
   - **Type**: Jest
   - **Jest package**: `<project>/node_modules/jest`
   - **Working directory**: `<project>/apps/backend`
   - **Jest options**: `--config ./jest.config.js`

### CI/CD Integration

**GitHub Actions** (`.github/workflows/test.yml`):

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci
      - run: npx nx run-many --target=test --all --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/apps/backend/lcov.info
```

---

## Common Patterns

### Type-Only Imports for Dependency Injection

```typescript
// ✅ GOOD - Type-only import doesn't trigger actual import
import type { Job, Policy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// ❌ BAD - Value import can cause dependency issues
import { Job, Policy } from '@prisma/client';
```

### Mock Setup in beforeEach

```typescript
// ✅ GOOD - Fresh mocks for each test
beforeEach(() => {
  jest.clearAllMocks();
  mockService.method.mockResolvedValue(defaultValue);
});

// ❌ BAD - Shared state between tests
const mockService = {
  method: jest.fn().mockResolvedValue(value),
};
```

### Clearing Mocks Between Tests

```typescript
// ✅ GOOD - Clear all mocks
beforeEach(() => {
  jest.clearAllMocks();
});

// ✅ GOOD - Reset specific mock
beforeEach(() => {
  mockService.method.mockReset();
});

// ✅ GOOD - Restore original implementation
afterEach(() => {
  jest.restoreAllMocks();
});
```

### Testing with Timers

```typescript
describe('Delayed Operations', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should execute after delay', () => {
    const callback = jest.fn();

    service.delayedAction(callback, 1000);

    expect(callback).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
```

### Testing Observable Streams (RxJS)

```typescript
import { firstValueFrom } from 'rxjs';

it('should emit value from observable', async () => {
  const result = await firstValueFrom(service.getData$());
  expect(result).toEqual(expectedValue);
});

// Or with subscriptions
it('should emit multiple values', (done) => {
  const values: any[] = [];

  service.getData$().subscribe({
    next: (value) => values.push(value),
    complete: () => {
      expect(values).toEqual([1, 2, 3]);
      done();
    },
  });
});
```

### Testing with Environment Variables

```typescript
describe('Environment Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use custom port from env', () => {
    process.env.PORT = '5000';

    const config = new ConfigService();

    expect(config.getPort()).toBe(5000);
  });
});
```

---

## Testing Checklist

### Before Writing Tests

- [ ] Understand the business logic being tested
- [ ] Identify all code paths (happy path + error cases)
- [ ] List all external dependencies to mock
- [ ] Determine test boundaries (unit vs integration)

### Service Unit Tests

- [ ] Test happy path with valid inputs
- [ ] Test error cases with invalid inputs
- [ ] Test edge cases (null, undefined, empty arrays)
- [ ] Mock all external dependencies (DB, APIs, files)
- [ ] Verify method calls on dependencies
- [ ] Test async error handling
- [ ] Clear mocks in `beforeEach`

### Controller Tests

- [ ] Mock service layer completely
- [ ] Test each HTTP endpoint (GET, POST, PUT, DELETE)
- [ ] Test request validation (DTOs)
- [ ] Test response transformation
- [ ] Test error responses (400, 404, 500)
- [ ] Verify service methods are called correctly

### Integration Tests

- [ ] Set up test database/fixtures
- [ ] Test full request/response cycle
- [ ] Test database transactions
- [ ] Test cascade operations
- [ ] Clean up test data in `afterEach`
- [ ] Test race conditions (if applicable)

### Error Handling Tests

- [ ] Test each type of exception
- [ ] Verify error messages
- [ ] Test rollback logic
- [ ] Test cleanup on failure
- [ ] Test partial failure scenarios

### Coverage Verification

- [ ] Run with `--coverage` flag
- [ ] Review uncovered lines
- [ ] Add tests for critical uncovered paths
- [ ] Ignore truly untestable code (use comments)

---

## Troubleshooting

### Common Issues

#### Issue: "Cannot find module" in tests

```typescript
// Problem: Module resolution differs in tests
import { Service } from '../service';

// Solution: Use explicit path or configure moduleNameMapper
// jest.config.js
module.exports = {
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/$1',
  },
};
```

#### Issue: "Timeout - Async callback was not invoked"

```typescript
// Problem: Async test not completing
it('should complete', (done) => {
  service.asyncMethod();
  // Missing done() call
});

// Solution: Always call done() or use async/await
it('should complete', async () => {
  await service.asyncMethod();
});
```

#### Issue: "Mock function not called"

```typescript
// Problem: Wrong mock reference
const mockFn = jest.fn();
service.setCallback(jest.fn()); // Different instance!
expect(mockFn).toHaveBeenCalled(); // Fails

// Solution: Use same reference
const mockFn = jest.fn();
service.setCallback(mockFn);
expect(mockFn).toHaveBeenCalled();
```

#### Issue: "Tests passing locally but failing in CI"

Common causes:
- **Timezone differences**: Use UTC in tests
- **File system differences**: Mock `fs` operations
- **Timing issues**: Use `jest.useFakeTimers()`
- **Parallel execution**: Ensure test isolation

```typescript
// Solution: Set consistent timezone
beforeAll(() => {
  process.env.TZ = 'UTC';
});
```

#### Issue: "Jest did not exit after tests"

```typescript
// Problem: Open handles (timers, connections)
// Solution: Clean up in afterAll
afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
  jest.clearAllTimers();
});
```

### Performance Issues

#### Slow Tests

```typescript
// Problem: Real database queries
it('should fetch data', async () => {
  const result = await prisma.user.findMany(); // Slow!
});

// Solution: Mock Prisma
mockPrismaService.user.findMany.mockResolvedValue(mockData);
```

#### Too Many Mocks

```typescript
// Problem: Over-mocking makes tests brittle
jest.mock('./module1');
jest.mock('./module2');
jest.mock('./module3');

// Solution: Only mock external boundaries
// Don't mock internal utilities/helpers
```

---

## Best Practices Summary

### DO ✅

- Write tests first (TDD) when possible
- Test behavior, not implementation
- Mock external dependencies (DB, APIs, file system)
- Use descriptive test names: `should [expected behavior] when [condition]`
- Clear mocks between tests with `jest.clearAllMocks()`
- Test both success and failure paths
- Use `async/await` for async tests
- Group related tests with `describe` blocks
- Add comments for complex test setup
- Keep tests fast (< 100ms per unit test)

### DON'T ❌

- Don't test framework code (NestJS, Angular internals)
- Don't test trivial getters/setters
- Don't share state between tests
- Don't use real database/file system in unit tests
- Don't ignore failing tests (fix or remove)
- Don't test implementation details (private methods)
- Don't mock everything (test real interactions when safe)
- Don't write flaky tests (random failures)
- Don't skip error cases
- Don't commit `.only` or `.skip` without reason

---

## Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [NestJS Testing Guide](https://docs.nestjs.com/fundamentals/testing)
- [Angular Testing Guide](https://angular.io/guide/testing)
- [Testing Best Practices (Martin Fowler)](https://martinfowler.com/testing/)
- [Test-Driven Development (Kent Beck)](https://www.amazon.com/Test-Driven-Development-Kent-Beck/dp/0321146530)

---

**Last Updated**: October 1, 2025
**Maintained by**: BitBonsai Development Team
**For questions**: See [TESTING_EXAMPLES.md](./TESTING_EXAMPLES.md) for complete working examples
