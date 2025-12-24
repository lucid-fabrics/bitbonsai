import { createFeatureSelector, createSelector } from '@ngrx/store';
import { LoginState } from './login.reducer';

export const selectLoginState = createFeatureSelector<LoginState>('login');

export const selectLoading = createSelector(selectLoginState, (state) => state.loading);

export const selectError = createSelector(selectLoginState, (state) => state.error);
