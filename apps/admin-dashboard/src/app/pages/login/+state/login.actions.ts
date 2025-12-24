import { createAction, props } from '@ngrx/store';

export const login = createAction('[Login] Login', props<{ apiKey: string }>());

export const loginSuccess = createAction('[Login] Login Success');

export const loginFailure = createAction('[Login] Login Failure', props<{ error: string }>());

export const clearError = createAction('[Login] Clear Error');
