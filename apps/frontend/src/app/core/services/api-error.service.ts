import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ApiErrorService {
  private readonly showConnectionErrorSubject = new BehaviorSubject<boolean>(false);

  // Consecutive failures required (resets on any success) before showing the connection modal.
  // Lifetime cumulative count caused false positives after just 2 unrelated transient failures.
  private consecutiveErrors = 0;
  private readonly ERROR_THRESHOLD = 3;

  showConnectionError$ = this.showConnectionErrorSubject.asObservable();

  reportConnectionError(): void {
    this.consecutiveErrors++;
    if (this.consecutiveErrors >= this.ERROR_THRESHOLD) {
      this.showConnectionErrorSubject.next(true);
    }
  }

  reportSuccess(): void {
    this.consecutiveErrors = 0;
    if (this.showConnectionErrorSubject.value) {
      this.showConnectionErrorSubject.next(false);
    }
  }

  dismissError(): void {
    this.showConnectionErrorSubject.next(false);
    this.consecutiveErrors = 0;
  }

  resetErrorCount(): void {
    this.consecutiveErrors = 0;
  }
}
