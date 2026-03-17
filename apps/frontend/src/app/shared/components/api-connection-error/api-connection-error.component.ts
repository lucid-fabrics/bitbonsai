import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { TranslocoModule } from '@ngneat/transloco';
import { ApiErrorService } from '../../../core/services/api-error.service';

@Component({
  selector: 'app-api-connection-error',
  standalone: true,
  imports: [AsyncPipe, TranslocoModule],
  templateUrl: './api-connection-error.component.html',
  styleUrl: './api-connection-error.component.scss',
})
export class ApiConnectionErrorComponent {
  private readonly apiErrorService = inject(ApiErrorService);
  showError$ = this.apiErrorService.showConnectionError$;

  dismiss(): void {
    this.apiErrorService.dismissError();
  }

  reload(): void {
    window.location.reload();
  }
}
