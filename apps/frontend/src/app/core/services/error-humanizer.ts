import type { HttpErrorResponse } from '@angular/common/http';

/**
 * Maps any error to user-friendly text. Server and exception messages are
 * never passed through to the UI; callers supply the friendly fallback.
 */
export function humanizeError(error: unknown, fallback: string): string {
  const status = (error as HttpErrorResponse)?.status;
  if (status === 0 || status === 504) {
    return 'Cannot reach BitBonsai right now. It usually reconnects on its own.';
  }
  return fallback;
}
