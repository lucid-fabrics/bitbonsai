import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ErrorLoggerService {
  error(message: string, error?: unknown): void {
    // In production, this could send to a monitoring service
    if (typeof console !== 'undefined') {
      console.error(`[BitBonsai] ${message}`, error);
    }
  }
}
