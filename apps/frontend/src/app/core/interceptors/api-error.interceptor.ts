import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ApiErrorService } from '../services/api-error.service';

export const apiErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const apiErrorService = inject(ApiErrorService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // Check if it's a network/connection error
      if (error.status === 0 || error.status === 504) {
        apiErrorService.reportConnectionError();
      }

      return throwError(() => error);
    })
  );
};
