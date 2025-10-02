import { Page, Locator } from '@playwright/test';

/**
 * Base Page Object with common functionality for all pages
 */
export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to a specific URL
   */
  async goto(path: string): Promise<void> {
    await this.page.goto(path);
  }

  /**
   * Wait for page to be fully loaded
   */
  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Get element by test ID
   */
  getByTestId(testId: string): Locator {
    return this.page.locator(`[data-testid="${testId}"]`);
  }

  /**
   * Wait for an element to be visible
   */
  async waitForElement(selector: string): Promise<void> {
    await this.page.waitForSelector(selector, { state: 'visible' });
  }

  /**
   * Take a screenshot
   */
  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `screenshots/${name}.png` });
  }

  /**
   * Fill input field by label
   */
  async fillByLabel(label: string, value: string): Promise<void> {
    await this.page.getByLabel(label).fill(value);
  }

  /**
   * Click button by role and text
   */
  async clickButton(text: string): Promise<void> {
    await this.page.getByRole('button', { name: text }).click();
  }

  /**
   * Check if element exists
   */
  async elementExists(selector: string): Promise<boolean> {
    const count = await this.page.locator(selector).count();
    return count > 0;
  }

  /**
   * Get text content of element
   */
  async getTextContent(selector: string): Promise<string> {
    const element = this.page.locator(selector);
    return (await element.textContent()) || '';
  }
}
