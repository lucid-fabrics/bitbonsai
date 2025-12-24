import { License } from '../../services/license-api.service';

/**
 * Business Object for Licenses
 * ALL business logic for licenses component MUST live here
 */
export class LicensesBo {
  /**
   * Validate email format
   */
  static isValidEmail(email: string): boolean {
    if (!email || !email.trim()) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  }

  /**
   * Validate tier selection
   */
  static isValidTier(tier: string): boolean {
    const validTiers = [
      'FREE',
      'PATREON_SUPPORTER',
      'PATREON_PLUS',
      'PATREON_PRO',
      'PATREON_ULTIMATE',
      'COMMERCIAL_STARTER',
      'COMMERCIAL_PRO',
      'COMMERCIAL_ENTERPRISE',
    ];
    return validTiers.includes(tier);
  }

  /**
   * Validate new license form
   */
  static isValidLicenseForm(email: string, tier: string): boolean {
    return LicensesBo.isValidEmail(email) && LicensesBo.isValidTier(tier);
  }

  /**
   * Check if can go to previous page
   */
  static canGoPrevious(currentPage: number): boolean {
    return currentPage > 0;
  }

  /**
   * Check if can go to next page
   */
  static canGoNext(currentPage: number, pageSize: number, total: number): boolean {
    return (currentPage + 1) * pageSize < total;
  }

  /**
   * Get confirmation message for revocation
   */
  static getRevokeConfirmationMessage(license: License): string {
    return `Revoke license for ${license.email}?`;
  }

  /**
   * Format error message
   */
  static getErrorMessage(error: Error, action: string): string {
    return `Failed to ${action}: ${error.message}`;
  }

  /**
   * Check if search query is valid
   */
  static hasValidSearchQuery(searchEmail: string): boolean {
    return searchEmail.trim().length > 0;
  }

  /**
   * Format page info text
   */
  static getPageInfo(currentPage: number, licensesCount: number, total: number): string {
    return `Page ${currentPage + 1} - Showing ${licensesCount} of ${total} licenses`;
  }
}
