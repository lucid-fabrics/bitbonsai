/**
 * Business Object for clipboard operations
 * Following SRP: Separates clipboard logic from components
 */
export class ClipboardBo {
  /**
   * Copy text to clipboard and return success status
   * @param text - Text to copy
   * @returns Promise<boolean> - true if copy succeeded
   */
  static async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Copy text to clipboard with temporary success message
   * @param text - Text to copy
   * @param label - Label to display in success message
   * @param duration - Duration to show message in ms (default: 3000)
   * @returns Promise with success message or null
   */
  static async copyWithMessage(
    text: string,
    label: string,
    duration = 3000
  ): Promise<{ message: string | null; clear: () => void }> {
    const success = await ClipboardBo.copyToClipboard(text);

    if (!success) {
      return {
        message: null,
        clear: () => {
          /* no-op */
        },
      };
    }

    const message = `${label} copied to clipboard`;
    const timeoutId = setTimeout(() => {
      /* no-op */
    }, duration);

    return {
      message,
      clear: () => clearTimeout(timeoutId),
    };
  }
}
