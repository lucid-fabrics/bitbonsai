/**
 * Login Business Object
 * Contains ALL business logic for login feature
 * Components MUST NOT contain logic - delegate to this BO
 */
export class LoginBo {
  /**
   * Validate API key format
   */
  static isValidApiKeyFormat(apiKey: string): boolean {
    return apiKey.length >= 32 && apiKey.trim().length === apiKey.length;
  }

  /**
   * Get error message for display
   */
  static getErrorMessage(_error: Error): string {
    return 'Invalid API key. Please try again.';
  }

  /**
   * Determine if form should be disabled
   */
  static isFormDisabled(apiKey: string, loading: boolean): boolean {
    return !apiKey || loading;
  }

  /**
   * Get button text based on loading state
   */
  static getButtonText(loading: boolean): string {
    return loading ? 'Verifying...' : 'Login';
  }
}
