import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { type Observable, of, throwError } from 'rxjs';
import { PolicyClient } from '../services/policy.client';
import * as policiesActions from './policies.actions';
import { PoliciesEffects } from './policies.effects';

describe('PoliciesEffects', () => {
  let actions$: Observable<Action>;
  let effects: PoliciesEffects;
  let service: jasmine.SpyObj<PolicyClient>;

  beforeEach(() => {
    const serviceSpy = jasmine.createSpyObj('PolicyClient', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        PoliciesEffects,
        provideMockActions(() => actions$),
        { provide: PolicyClient, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(PoliciesEffects);
    service = TestBed.inject(PolicyClient) as jasmine.SpyObj<PolicyClient>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = [{ id: '1', name: 'Test' }] as never;
      service.getAll.and.returnValue(of(mockData));

      actions$ = of(policiesActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(policiesActions.loadSuccess.type);
        expect(service.getAll).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getAll.and.returnValue(throwError(() => error));

      actions$ = of(policiesActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(policiesActions.loadFailure.type);
        done();
      });
    });
  });

  // TODO: Add tests for other effects (create, update, delete)
});
