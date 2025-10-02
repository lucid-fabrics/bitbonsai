import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page Object for Libraries page
 */
export class LibrariesPage extends BasePage {
  // Locators
  readonly addLibraryButton: Locator;
  readonly libraryCards: Locator;
  readonly emptyState: Locator;
  readonly loadingState: Locator;

  constructor(page: Page) {
    super(page);
    this.addLibraryButton = page.getByRole('button', { name: /add library/i });
    this.libraryCards = page.locator('[data-testid="library-card"]');
    this.emptyState = page.locator('.empty-state');
    this.loadingState = page.locator('.loading-state');
  }

  /**
   * Navigate to libraries page
   */
  async navigate(): Promise<void> {
    await this.goto('/libraries');
    await this.waitForLoad();
  }

  /**
   * Get count of library cards
   */
  async getLibraryCount(): Promise<number> {
    await this.waitForLoad();
    return await this.libraryCards.count();
  }

  /**
   * Check if empty state is shown
   */
  async isEmptyStateVisible(): Promise<boolean> {
    return await this.emptyState.isVisible();
  }

  /**
   * Click add library button
   */
  async clickAddLibrary(): Promise<void> {
    await this.addLibraryButton.click();
  }

  /**
   * Fill library form
   */
  async fillLibraryForm(data: {
    name: string;
    path: string;
    mediaType: string;
    nodeId: string;
  }): Promise<void> {
    await this.fillByLabel('Library Name', data.name);
    await this.fillByLabel('Library Path', data.path);
    await this.page.selectOption('select#mediaType', data.mediaType);
    await this.page.selectOption('select#nodeId', data.nodeId);
  }

  /**
   * Submit library form
   */
  async submitLibraryForm(): Promise<void> {
    await this.clickButton(/create library|update library/i);
  }

  /**
   * Delete library by name
   */
  async deleteLibrary(name: string): Promise<void> {
    const card = this.page.locator('[data-testid="library-card"]', { hasText: name });
    await card.getByRole('button', { name: /delete/i }).click();
    await this.clickButton('Delete');
  }

  /**
   * Get library card by name
   */
  getLibraryCard(name: string): Locator {
    return this.page.locator('[data-testid="library-card"]', { hasText: name });
  }

  /**
   * Check if library exists
   */
  async libraryExists(name: string): Promise<boolean> {
    const card = this.getLibraryCard(name);
    return await card.isVisible();
  }
}
