# Frontend Test Generator

Automatically generates comprehensive unit tests for BitBonsai frontend following `testing-guidelines.md` and `angular-guidelines.md`.

## What It Generates

✅ **Service Tests** (`core/services/*.service.spec.ts`)
- Tests for service-to-client communication
- BO transformation verification
- Error handling tests

✅ **Business Object Tests** (`core/business-objects/*.bo.spec.ts`)
- Constructor and mapping tests
- Business logic method tests
- Edge case handling

✅ **Effects Tests** (`features/*/+state/*.effects.spec.ts`)
- Action dispatching tests
- Service integration tests
- Success/failure action tests

✅ **Component Tests** (`features/*/*.component.spec.ts`)
- Component initialization tests
- Template rendering tests
- User interaction tests

## Usage

### Prerequisites

```bash
npm install -D ts-node @types/node
```

### Run the Generator

```bash
# From project root
npx ts-node tools/generators/generate-frontend-tests.ts
```

### Output

The script will:
1. Scan all service, BO, effects, and component files
2. Generate corresponding `.spec.ts` files
3. Skip files that already have tests
4. Print a summary of generated files

Example output:
```
✅ Generated: apps/frontend/src/app/core/services/policy.service.spec.ts
✅ Generated: apps/frontend/src/app/core/business-objects/policy.bo.spec.ts
✅ Generated: apps/frontend/src/app/features/policies/+state/policies.effects.spec.ts
✅ Generated: apps/frontend/src/app/features/policies/policies.component.spec.ts

Total: 24 test files generated
```

## Next Steps After Generation

### 1. Customize Tests

The generated tests provide boilerplate structure. You need to:

- Add specific assertions based on component/service logic
- Update mock data to match actual models
- Add edge cases and error scenarios
- Test computed signals and business logic

### 2. Run Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### 3. Verify Coverage

Target: **80% minimum coverage** for all new code

```bash
npm run test:coverage
```

Check the coverage report at `coverage/index.html`

## Test Structure

All generated tests follow this pattern:

```typescript
describe('ComponentName', () => {
  let component: ComponentName;
  let fixture: ComponentFixture<ComponentName>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComponentName],
      providers: [/* ... */],
    }).compileComponents();

    fixture = TestBed.createComponent(ComponentName);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Additional tests...
});
```

## Best Practices

### Service Tests
- ✅ Test that services call the correct client methods
- ✅ Verify BO transformation (response → BO)
- ✅ Test error handling from client
- ✅ Mock all dependencies

### BO Tests
- ✅ Test constructor mapping from models
- ✅ Test business logic methods (formatting, calculations)
- ✅ Test null/undefined handling
- ✅ Test optional field handling

### Effects Tests
- ✅ Use `provideMockActions()` from `@ngrx/effects/testing`
- ✅ Test success and failure action paths
- ✅ Verify service method calls
- ✅ Test action dispatching

### Component Tests
- ✅ Use `provideMockStore()` from `@ngrx/store/testing`
- ✅ Test template rendering
- ✅ Test user interactions (clicks, inputs)
- ✅ Test computed signals and reactive state

## Troubleshooting

### "Cannot find module" errors

Install missing dependencies:
```bash
npm install -D @ngrx/store @ngrx/effects jasmine-core @types/jasmine
```

### Tests fail with "No provider for X"

Add missing providers to `TestBed.configureTestingModule()`:
```typescript
providers: [
  ComponentName,
  { provide: ServiceName, useValue: mockService },
]
```

### Import errors

Verify import paths match your file structure:
```typescript
import { PolicyBo } from '../business-objects/policy.bo';
```

## Integration with CI/CD

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
- name: Run Frontend Tests
  run: npm test -- --watch=false --browsers=ChromeHeadless

- name: Check Coverage
  run: npm run test:coverage
```

## Additional Resources

- [Angular Testing Guide](https://angular.dev/guide/testing)
- [NgRx Testing Guide](https://ngrx.io/guide/effects/testing)
- [Jasmine Documentation](https://jasmine.github.io/)
- BitBonsai Testing Guidelines: `~/git/code-conventions/testing-guidelines.md`
