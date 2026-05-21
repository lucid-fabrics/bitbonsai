import { expect, test } from '@playwright/test';
import { mockApiResponses } from '../fixtures/test-data';
import { PoliciesPage } from '../page-objects/PoliciesPage';

test.describe('Policies Page', () => {
  let policiesPage: PoliciesPage;

  test.beforeEach(async ({ page }) => {
    policiesPage = new PoliciesPage(page);

    // Mock API responses
    await page.route('**/api/v1/policies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockApiResponses.policies),
      });
    });

    await page.route('**/api/v1/policies/presets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockApiResponses.presets),
      });
    });

    await policiesPage.navigate();
  });

  test('should display policies page', async () => {
    await expect(policiesPage.page).toHaveTitle(/BitBonsai/i);
    await expect(policiesPage.page.getByRole('heading', { name: /policies/i })).toBeVisible();
  });

  test('should display policy cards when policies exist', async () => {
    const count = await policiesPage.getPolicyCount();
    expect(count).toBeGreaterThan(0);

    // Check if first policy card is visible
    const firstCard = policiesPage.policyCards.first();
    await expect(firstCard).toBeVisible();
    await expect(firstCard).toContainText('Quality AV1 for Anime');
  });

  test('should populate all fields correctly when editing a policy', async () => {
    // Click edit button on the first policy (Quality AV1 for Anime)
    await policiesPage.clickEditPolicy('Quality AV1 for Anime');

    // Wait for form modal to open
    await expect(policiesPage.page.locator('.modal-overlay, [role="dialog"]')).toBeVisible();

    // Verify Policy Name
    const policyName = await policiesPage.getFormInputValue(/policy name/i);
    expect(policyName).toBe('Quality AV1 for Anime');

    // Verify Preset is selected
    const presetValue = await policiesPage.page
      .locator('input[name="preset"], select[name="preset"]')
      .inputValue();
    expect(presetValue).toBe('QUALITY_AV1');

    // Verify Target Codec is populated
    const codecValue = await policiesPage.page
      .locator('select[name="targetCodec"], input[name="targetCodec"]')
      .inputValue();
    expect(codecValue).toBe('AV1');

    // Verify CRF Quality value
    const crfValue = await policiesPage.getCRFQualityValue();
    expect(crfValue).toBe('28');

    // Verify CRF Quality label is displayed
    const crfLabel = await policiesPage.getCRFQualityLabel();
    expect(crfLabel).toMatch(/Quality|Medium|Good/i);

    // Verify Device Profiles checkboxes
    const isWebChecked = await policiesPage.page
      .locator('input[type="checkbox"][value="WEB"], input[type="checkbox"]')
      .nth(2)
      .isChecked();
    expect(isWebChecked).toBe(true);

    // Verify WEB device profile tooltip/explanation includes media servers
    const webProfileText = await policiesPage.page
      .locator('text=/Jellyfin|Plex|Emby/i')
      .textContent();
    expect(webProfileText).toMatch(/Jellyfin|Plex|Emby/i);
  });

  test('should populate all fields correctly for Default policy', async () => {
    // Click edit button on the second policy (Default - Universal H.265)
    await policiesPage.clickEditPolicy('Default - Universal H.265 (Recommended)');

    // Wait for form modal to open
    await expect(policiesPage.page.locator('.modal-overlay, [role="dialog"]')).toBeVisible();

    // Verify Policy Name
    const policyName = await policiesPage.getFormInputValue(/policy name/i);
    expect(policyName).toBe('Default - Universal H.265 (Recommended)');

    // Verify Target Codec is H.265/HEVC
    const codecValue = await policiesPage.page
      .locator('select[name="targetCodec"], input[name="targetCodec"]')
      .inputValue();
    expect(codecValue).toBe('HEVC');

    // Verify CRF Quality value
    const crfValue = await policiesPage.getCRFQualityValue();
    expect(crfValue).toBe('20');

    // Verify CRF Quality label shows appropriate text for CRF 20
    const crfLabel = await policiesPage.getCRFQualityLabel();
    expect(crfLabel).toMatch(/Excellent|Visually Lossless/i);

    // Verify ALL Device Profiles are checked for universal policy
    const checkboxes = policiesPage.page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();

    // Check that at least 4 device profiles are present and checked
    let checkedCount = 0;
    for (let i = 0; i < count; i++) {
      if (await checkboxes.nth(i).isChecked()) {
        checkedCount++;
      }
    }
    expect(checkedCount).toBeGreaterThanOrEqual(4); // Apple TV, Roku, Web, Chromecast
  });

  test('should show add policy button', async () => {
    await expect(policiesPage.addPolicyButton).toBeVisible();
    await expect(policiesPage.addPolicyButton).toBeEnabled();
  });

  test('should open policy form when add button is clicked', async () => {
    await policiesPage.clickAddPolicy();

    // Check if form modal is visible
    await expect(
      policiesPage.page.getByRole('heading', { name: /add|create.*policy/i })
    ).toBeVisible();
  });

  test('should display preset cards for quick policy creation', async () => {
    // Check if preset selection cards are visible
    const presetCards = policiesPage.page.locator('[data-testid="preset-card"]');
    const count = await presetCards.count();

    if (count > 0) {
      // If presets are displayed, verify they contain expected presets
      await expect(presetCards.first()).toBeVisible();

      // Check for Balanced HEVC preset
      await expect(policiesPage.page.getByText(/Balanced HEVC/i)).toBeVisible();
    }
  });

  test('should close form when cancel button is clicked', async () => {
    await policiesPage.clickEditPolicy('Quality AV1 for Anime');

    // Verify form is open
    await expect(policiesPage.page.locator('.modal-overlay, [role="dialog"]')).toBeVisible();

    // Click cancel/close button
    await policiesPage.closeForm();

    // Verify form is closed
    await expect(policiesPage.page.locator('.modal-overlay, [role="dialog"]')).not.toBeVisible();
  });

  test('should display improved CRF quality labels', async () => {
    await policiesPage.clickEditPolicy('Default - Universal H.265 (Recommended)');

    // Wait for form to open
    await expect(policiesPage.page.locator('.modal-overlay, [role="dialog"]')).toBeVisible();

    // Check that CRF label includes helpful descriptive text
    const crfLabel = await policiesPage.getCRFQualityLabel();

    // Should contain quality descriptor AND file size hint
    expect(crfLabel).toMatch(/Excellent.*Large|Visually Lossless.*Huge|High.*Recommended/i);
  });

  test('should validate required fields in policy form', async ({ page }) => {
    await policiesPage.clickAddPolicy();

    // Try to submit empty form
    await policiesPage.submitPolicyForm();

    // Check for validation errors
    await expect(page.getByText(/name is required/i)).toBeVisible();
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Mock API error
    await page.route('**/api/v1/policies', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Internal server error',
          statusCode: 500,
        }),
      });
    });

    await policiesPage.navigate();

    // Check if error message is displayed
    await expect(page.getByText(/error/i)).toBeVisible();
  });

  test('should display loading state during data fetch', async ({ page }) => {
    // Mock slow API response
    await page.route('**/api/v1/policies', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockApiResponses.policies),
      });
    });

    await policiesPage.navigate();

    // Check if loading state is visible
    const isLoadingVisible = await policiesPage.loadingState.isVisible();
    expect(isLoadingVisible).toBe(true);
  });

  test('should verify device profile WEB includes media server explanation', async () => {
    await policiesPage.clickEditPolicy('Quality AV1 for Anime');

    // Wait for form to open
    await expect(policiesPage.page.locator('.modal-overlay, [role="dialog"]')).toBeVisible();

    // Find the WEB device profile checkbox or its parent container
    const webProfileSection = policiesPage.page.locator('text=/WEB|Web/i').first();
    await expect(webProfileSection).toBeVisible();

    // Hover over or click to reveal tooltip/explanation
    await webProfileSection.hover();

    // Wait a bit for tooltip to appear
    await policiesPage.page.waitForTimeout(500);

    // Check that explanation mentions Jellyfin, Plex, or Emby
    const hasMediaServerMention = await policiesPage.page
      .locator('text=/Jellyfin|Plex|Emby/i')
      .isVisible();
    expect(hasMediaServerMention).toBe(true);
  });
});
