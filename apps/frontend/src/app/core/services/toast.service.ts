import { Injectable } from '@angular/core';

/**
 * ToastService
 *
 * Provides a clean API for showing toast notifications throughout the app.
 * Uses vanilla JavaScript with CSS for lightweight, framework-independent toasts.
 *
 * Design Philosophy:
 * - Gentle and non-intrusive
 * - Brief duration (2-3 seconds)
 * - Bottom position for mobile-friendly UX
 * - Color-coded for quick visual feedback
 */
@Injectable({
  providedIn: 'root',
})
export class ToastService {
  private readonly TOAST_DURATION_SUCCESS = 2000;
  private readonly TOAST_DURATION_INFO = 2000;
  private readonly TOAST_DURATION_WARNING = 3000;
  private readonly TOAST_DURATION_ERROR = 3000;

  /**
   * Show success toast (green)
   * Use for: Successful operations, confirmations
   */
  success(message: string, duration?: number): void {
    this.showToast(message, 'success', duration || this.TOAST_DURATION_SUCCESS);
  }

  /**
   * Show info toast (blue/primary)
   * Use for: Information, status updates
   */
  info(message: string, duration?: number): void {
    this.showToast(message, 'info', duration || this.TOAST_DURATION_INFO);
  }

  /**
   * Show warning toast (orange)
   * Use for: Warnings, non-critical issues
   */
  warning(message: string, duration?: number): void {
    this.showToast(message, 'warning', duration || this.TOAST_DURATION_WARNING);
  }

  /**
   * Show error toast (red)
   * Use for: Errors, failed operations
   */
  error(message: string, duration?: number): void {
    this.showToast(message, 'error', duration || this.TOAST_DURATION_ERROR);
  }

  /**
   * Internal method to create and show toast
   */
  private showToast(
    message: string,
    type: 'success' | 'info' | 'warning' | 'error',
    duration: number
  ): void {
    // Create toast container if it doesn't exist
    let container = document.querySelector('.toast-container') as HTMLElement;
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = () => this.removeToast(toast);
    toast.appendChild(closeBtn);

    // Add to container with animation
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('toast-show'), 10);

    // Auto-remove after duration
    setTimeout(() => this.removeToast(toast), duration);
  }

  /**
   * Remove toast with animation
   */
  private removeToast(toast: HTMLElement): void {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }
}
