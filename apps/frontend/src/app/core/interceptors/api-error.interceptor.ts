import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { ApiErrorService } from '../services/api-error.service';

export const apiErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const apiErrorService = inject(ApiErrorService);

  return next(req).pipe(
    tap(() => {
      // Any successful response resets the consecutive-error counter and clears the modal.
      apiErrorService.reportSuccess();
    }),
    catchError((error: HttpErrorResponse) => {
      // Only network-level failures count toward the connection-error threshold.
      if (error.status === 0 || error.status === 504) {
        apiErrorService.reportConnectionError();
      }
      return throwError(() => error);
    })
  );
};
