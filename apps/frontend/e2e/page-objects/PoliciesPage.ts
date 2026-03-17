import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page Object for Policies page
 */
export class PoliciesPage extends BasePage {
  // Locators
  readonly addPolicyButton: Locator;
  readonly policyCards: Locator;
  readonly emptyState: Locator;
  readonly loadingState: Locator;

  constructor(page: Page) {
    super(page);
    this.addPolicyButton = page.getByRole('button', { name: /add policy/i });
    this.policyCards = page.locator('[data-testid="policy-card"]');
    this.emptyState = page.locator('.empty-state');
    this.loadingState = page.locator('.loading-state');
  }

  /**
   * Navigate to policies page
   */
  async navigate(): Promise<void> {
    await this.goto('/policies');
    await this.waitForLoad();
  }

  /**
   * Get count of policy cards
   */
  async getPolicyCount(): Promise<number> {
    await this.waitForLoad();
    return await this.policyCards.count();
  }

  /**
   * Click add policy button
   */
  async clickAddPolicy(): Promise<void> {
    await this.addPolicyButton.click();
  }

  /**
   * Get policy card by name
   */
  getPolicyCard(name: string): Locator {
    return this.page.locator('[data-testid="policy-card"]', { hasText: name });
  }

  /**
   * Click edit button on a policy card
   */
  async clickEditPolicy(policyName: string): Promise<void> {
    const card = this.getPolicyCard(policyName);
    await card.getByRole('button', { name: /edit/i }).click();
  }

  /**
   * Check if policy form modal is open
   */
  async isPolicyFormOpen(): Promise<boolean> {
    const modal = this.page.locator('.modal-overlay, [role="dialog"]');
    return await modal.isVisible();
  }

  /**
   * Get form input value by label
   */
  async getFormInputValue(label: string): Promise<string> {
    const input = this.page.getByLabel(label);
    return (await input.inputValue()) || '';
  }

  /**
   * Get form select value by label
   */
  async getFormSelectValue(label: string): Promise<string> {
    const select = this.page.getByLabel(label);
    return (await select.inputValue()) || '';
  }

  /**
   * Check if checkbox is checked
   */
  async isCheckboxChecked(label: string): Promise<boolean> {
    const checkbox = this.page.getByLabel(label);
    return await checkbox.isChecked();
  }

  /**
   * Get CRF quality value
   */
  async getCRFQualityValue(): Promise<string> {
    const crfInput = this.page.locator('input[type="range"], input[name="targetQuality"]');
    return (await crfInput.inputValue()) || '';
  }

  /**
   * Get CRF quality label text
   */
  async getCRFQualityLabel(): Promise<string> {
    const label = this.page.locator('.crf-label, .quality-label');
    return (await label.textContent()) || '';
  }

  /**
   * Close the policy form modal
   */
  async closeForm(): Promise<void> {
    const closeButton = this.page.getByRole('button', { name: /close|cancel/i });
    await closeButton.click();
  }

  /**
   * Submit policy form
   */
  async submitPolicyForm(): Promise<void> {
    await this.clickButton(/create policy|update policy/i);
  }

  /**
   * Delete policy by name
   */
  async deletePolicy(name: string): Promise<void> {
    const card = this.getPolicyCard(name);
    await card.getByRole('button', { name: /delete/i }).click();
    await this.clickButton(/delete policy|confirm/i);
  }
}
