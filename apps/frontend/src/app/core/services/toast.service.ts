import { Injectable, inject } from '@angular/core';
import { ToastController, type ToastOptions } from '@ionic/angular';

/**
 * ToastService
 *
 * Provides a clean API for showing toast notifications throughout the app.
 * Uses Ionic's ToastController for consistent, platform-native notifications.
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
  private readonly toastController = inject(ToastController);

  /**
   * Show success toast (green)
   * Use for: Successful operations, confirmations
   */
  async success(message: string, duration = 2000): Promise<void> {
    const options: ToastOptions = {
      message,
      duration,
      position: 'bottom',
      color: 'success',
      cssClass: 'toast-success',
      buttons: [
        {
          icon: 'close',
          role: 'cancel',
        },
      ],
    };

    const toast = await this.toastController.create(options);
    await toast.present();
  }

  /**
   * Show info toast (blue/primary)
   * Use for: Information, status updates
   */
  async info(message: string, duration = 2000): Promise<void> {
    const options: ToastOptions = {
      message,
      duration,
      position: 'bottom',
      color: 'primary',
      cssClass: 'toast-info',
      buttons: [
        {
          icon: 'close',
          role: 'cancel',
        },
      ],
    };

    const toast = await this.toastController.create(options);
    await toast.present();
  }

  /**
   * Show warning toast (orange)
   * Use for: Warnings, non-critical issues
   */
  async warning(message: string, duration = 3000): Promise<void> {
    const options: ToastOptions = {
      message,
      duration,
      position: 'bottom',
      color: 'warning',
      cssClass: 'toast-warning',
      buttons: [
        {
          icon: 'close',
          role: 'cancel',
        },
      ],
    };

    const toast = await this.toastController.create(options);
    await toast.present();
  }

  /**
   * Show error toast (red)
   * Use for: Errors, failed operations
   */
  async error(message: string, duration = 3000): Promise<void> {
    const options: ToastOptions = {
      message,
      duration,
      position: 'bottom',
      color: 'danger',
      cssClass: 'toast-error',
      buttons: [
        {
          icon: 'close',
          role: 'cancel',
        },
      ],
    };

    const toast = await this.toastController.create(options);
    await toast.present();
  }

  /**
   * Show custom toast with full control
   */
  async custom(options: {
    message: string;
    duration?: number;
    color?: string;
    icon?: string;
    position?: 'top' | 'bottom' | 'middle';
  }): Promise<void> {
    const toastOptions: ToastOptions = {
      message: options.message,
      duration: options.duration || 2000,
      position: options.position || 'bottom',
      color: options.color || 'medium',
      icon: options.icon,
      buttons: [
        {
          icon: 'close',
          role: 'cancel',
        },
      ],
    };

    const toast = await this.toastController.create(toastOptions);
    await toast.present();
  }
}
