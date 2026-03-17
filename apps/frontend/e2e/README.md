# BitBonsai Frontend E2E Tests

## Overview

End-to-end tests for BitBonsai frontend using Playwright. These tests verify the application works correctly from a user's perspective across multiple browsers.

## Technology Stack

- **Playwright** - Modern E2E testing framework
- **TypeScript** - Type-safe test code
- **Page Object Model** - Maintainable test architecture

## Directory Structure

```
e2e/
├── fixtures/           # Test data and mock responses
│   └── test-data.ts
├── page-objects/       # Page Object Model classes
│   ├── BasePage.ts
│   └── LibrariesPage.ts
├── tests/              # Test specifications
│   └── libraries.spec.ts
└── README.md
```

## Running Tests

### Run all tests

```bash
npm run test:e2e
```

### Run tests in UI mode (interactive)

```bash
npm run test:e2e:ui
```

### Run specific test file

```bash
npx playwright test tests/libraries.spec.ts
```

### Run tests for specific browser

```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

### Debug tests

```bash
npm run test:e2e:debug
```

### Generate test report

```bash
npx playwright show-report
```

## Writing Tests

### Basic Test Structure

```typescript
import { test, expect } from '@playwright/test';
import { LibrariesPage } from '../page-objects/LibrariesPage';

test.describe('Feature Name', () => {
  let page: LibrariesPage;

  test.beforeEach(async ({ page: playwrightPage }) => {
    page = new LibrariesPage(playwrightPage);
    await page.navigate();
  });

  test('should do something', async () => {
    // Arrange
    await page.clickButton('Add Library');

    // Act
    await page.fillLibraryForm({
      name: 'Test',
      path: '/test',
      mediaType: 'MOVIE',
      nodeId: 'node-1',
    });

    // Assert
    await expect(page.libraryCards.first()).toContainText('Test');
  });
});
```

### Page Object Pattern

```typescript
// page-objects/MyPage.ts
import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class MyPage extends BasePage {
  readonly myButton: Locator;

  constructor(page: Page) {
    super(page);
    this.myButton = page.getByRole('button', { name: 'My Button' });
  }

  async navigate(): Promise<void> {
    await this.goto('/my-page');
  }

  async clickMyButton(): Promise<void> {
    await this.myButton.click();
  }
}
```

### Mocking API Responses

```typescript
test('should handle API response', async ({ page }) => {
  await page.route('**/api/v1/libraries', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockApiResponses.libraries),
    });
  });

  await librariesPage.navigate();
  // Test continues...
});
```

## Best Practices

### DO ✅

- **Use Page Object Model** for reusable and maintainable tests
- **Mock API responses** to avoid dependency on backend state
- **Use semantic selectors** (role, label, text) over brittle selectors
- **Test user workflows** not implementation details
- **Keep tests independent** - each test should be able to run in isolation
- **Use descriptive test names** that explain what is being tested
- **Wait for elements** before interacting with them

```typescript
// Good
await page.getByRole('button', { name: 'Submit' }).click();
await expect(page.getByText('Success')).toBeVisible();

// Better - using Page Objects
await myPage.clickSubmit();
await expect(myPage.successMessage).toBeVisible();
```

### DON'T ❌

- **Don't use brittle selectors** (complex CSS, XPath)
- **Don't test implementation** (internal state, API calls directly)
- **Don't share state** between tests
- **Don't hard-code waits** - use Playwright's auto-waiting
- **Don't ignore flaky tests** - fix them or investigate

```typescript
// Bad
await page.locator('div.container > div:nth-child(3) > button').click();
await page.waitForTimeout(3000); // Hard-coded wait

// Good
await page.getByRole('button', { name: 'Submit' }).click();
await page.waitForLoadState('networkidle'); // Smart waiting
```

## Test Scenarios to Cover

### Critical User Flows

1. **Authentication** (if applicable)
   - Login with valid credentials
   - Login with invalid credentials
   - Logout
   - Session persistence

2. **Libraries Management**
   - View libraries list
   - Create new library
   - Edit existing library
   - Delete library
   - Scan library

3. **Policies Management**
   - Create policy from preset
   - Create custom policy
   - Edit policy
   - Delete policy
   - Assign policy to library

4. **Nodes Management**
   - Register new node
   - Pair linked node
   - View node details
   - Node goes offline handling

5. **Queue Management**
   - View encoding queue
   - Pause/resume jobs
   - Cancel jobs
   - View job details

6. **Insights Dashboard**
   - View statistics
   - Filter by time range
   - Export data

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## Debugging

### Visual Debugging

```bash
# Run in headed mode
npx playwright test --headed

# Run in debug mode
npx playwright test --debug

# Run with UI mode
npx playwright test --ui
```

### Trace Viewer

```bash
# Run with tracing
npx playwright test --trace on

# Open trace viewer
npx playwright show-trace trace.zip
```

### Screenshots and Videos

Screenshots and videos are automatically captured on failure. Find them in:
- `test-results/` - Screenshots
- `playwright-report/` - Full HTML report with videos

## Performance Testing

```typescript
test('should load page quickly', async ({ page }) => {
  const start = Date.now();

  await page.goto('/libraries');
  await page.waitForLoadState('networkidle');

  const loadTime = Date.now() - start;

  expect(loadTime).toBeLessThan(3000); // 3 seconds
});
```

## Accessibility Testing

```typescript
test('should be accessible', async ({ page }) => {
  await page.goto('/libraries');

  // Check for proper heading structure
  const h1 = await page.locator('h1').count();
  expect(h1).toBeGreaterThan(0);

  // Check for alt text on images
  const images = await page.locator('img').count();
  for (let i = 0; i < images; i++) {
    const img = page.locator('img').nth(i);
    await expect(img).toHaveAttribute('alt');
  }
});
```

## Troubleshooting

### Tests Failing Intermittently

1. **Add explicit waits** for dynamic content
2. **Check for race conditions** in async operations
3. **Increase timeouts** if tests are running on slow CI
4. **Mock network responses** to avoid backend flakiness

### Element Not Found

```typescript
// Wait for element explicitly
await page.waitForSelector('[data-testid="library-card"]', {
  state: 'visible',
  timeout: 10000,
});

// Or use expect with timeout
await expect(page.locator('[data-testid="library-card"]')).toBeVisible({
  timeout: 10000,
});
```

### Slow Tests

1. **Run tests in parallel** (default in Playwright)
2. **Mock API calls** instead of making real requests
3. **Use `page.goto()` options** to skip waiting for certain resources
4. **Reduce test scope** - test one thing per test

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Page Object Model](https://playwright.dev/docs/pom)
- [API Testing](https://playwright.dev/docs/api-testing)
- [Accessibility Testing](https://playwright.dev/docs/accessibility-testing)

## Future Enhancements

- [ ] Add visual regression testing
- [ ] Implement custom fixtures for common setups
- [ ] Add performance benchmarking
- [ ] Create reusable test utilities
- [ ] Add accessibility testing with axe-core
- [ ] Implement parallel test execution optimization
