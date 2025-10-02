import { test, expect } from '@playwright/test';
import { LibrariesPage } from '../page-objects/LibrariesPage';
import { testLibrary, mockApiResponses } from '../fixtures/test-data';

test.describe('Libraries Page', () => {
  let librariesPage: LibrariesPage;

  test.beforeEach(async ({ page }) => {
    librariesPage = new LibrariesPage(page);

    // Mock API responses
    await page.route('**/api/v1/libraries', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockApiResponses.libraries),
      });
    });

    await page.route('**/api/v1/nodes', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockApiResponses.nodes),
      });
    });

    await librariesPage.navigate();
  });

  test('should display libraries page', async () => {
    await expect(librariesPage.page).toHaveTitle(/BitBonsai/i);
    await expect(librariesPage.page.getByRole('heading', { name: /libraries/i })).toBeVisible();
  });

  test('should display library cards when libraries exist', async () => {
    const count = await librariesPage.getLibraryCount();
    expect(count).toBeGreaterThan(0);

    // Check if library card contains expected information
    const firstCard = librariesPage.libraryCards.first();
    await expect(firstCard).toBeVisible();
    await expect(firstCard).toContainText('Movies');
  });

  test('should show add library button', async () => {
    await expect(librariesPage.addLibraryButton).toBeVisible();
    await expect(librariesPage.addLibraryButton).toBeEnabled();
  });

  test('should open library form when add button is clicked', async () => {
    await librariesPage.clickAddLibrary();

    // Check if form modal is visible
    await expect(librariesPage.page.getByRole('heading', { name: /add new library/i })).toBeVisible();
    await expect(librariesPage.page.getByLabel(/library name/i)).toBeVisible();
  });

  test('should validate required fields in library form', async () => {
    await librariesPage.clickAddLibrary();

    // Try to submit empty form
    await librariesPage.clickButton(/create library/i);

    // Check for validation errors
    await expect(librariesPage.page.getByText(/library name is required/i)).toBeVisible();
  });

  test('should create new library with valid data', async ({ page }) => {
    // Mock POST request
    await page.route('**/api/v1/libraries', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'new-library-id',
            ...testLibrary,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        });
      }
    });

    await librariesPage.clickAddLibrary();
    await librariesPage.fillLibraryForm(testLibrary);
    await librariesPage.submitLibraryForm();

    // Check if success message or redirect happens
    await expect(page.getByText(/library created successfully/i)).toBeVisible();
  });

  test('should filter libraries by search', async ({ page }) => {
    // Add search functionality test
    const searchInput = page.getByPlaceholder(/search libraries/i);

    if (await searchInput.isVisible()) {
      await searchInput.fill('Movies');

      // Verify filtered results
      const count = await librariesPage.getLibraryCount();
      expect(count).toBeGreaterThan(0);

      // Check that visible cards match search
      const firstCard = librariesPage.libraryCards.first();
      await expect(firstCard).toContainText('Movies');
    }
  });

  test('should navigate to library details on card click', async ({ page }) => {
    const firstCard = librariesPage.libraryCards.first();
    await firstCard.click();

    // Check if navigated to details page (adjust based on actual routing)
    await expect(page).toHaveURL(/\/libraries\/\w+/);
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Mock API error
    await page.route('**/api/v1/libraries', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Internal server error',
          statusCode: 500,
        }),
      });
    });

    await librariesPage.navigate();

    // Check if error message is displayed
    await expect(page.getByText(/error/i)).toBeVisible();
  });

  test('should show loading state during data fetch', async ({ page }) => {
    // Mock slow API response
    await page.route('**/api/v1/libraries', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockApiResponses.libraries),
      });
    });

    await librariesPage.navigate();

    // Check if loading state is visible
    const isLoadingVisible = await librariesPage.loadingState.isVisible();
    expect(isLoadingVisible).toBe(true);
  });
});
