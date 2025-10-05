import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ApiErrorService {
  private readonly showConnectionErrorSubject = new BehaviorSubject<boolean>(false);
  private errorCount = 0;
  private readonly ERROR_THRESHOLD = 2; // Show modal after 2 consecutive errors

  showConnectionError$ = this.showConnectionErrorSubject.asObservable();

  reportConnectionError(): void {
    this.errorCount++;

    if (this.errorCount >= this.ERROR_THRESHOLD) {
      this.showConnectionErrorSubject.next(true);
    }
  }

  dismissError(): void {
    this.showConnectionErrorSubject.next(false);
    this.errorCount = 0;
  }

  resetErrorCount(): void {
    this.errorCount = 0;
  }
}
