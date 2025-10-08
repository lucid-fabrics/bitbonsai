import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { type Observable, of, throwError } from 'rxjs';
import { PolicyClient } from '../services/policy.client';
import { PoliciesActions } from './policies.actions';
import { PoliciesEffects } from './policies.effects';

describe('PoliciesEffects', () => {
  let actions$: Observable<Action>;
  let effects: PoliciesEffects;
  let service: jest.Mocked<PolicyClient>;

  beforeEach(() => {
    const serviceSpy = {
      getPolicies: jest.fn(),
      getPolicy: jest.fn(),
      getPresets: jest.fn(),
      createPolicy: jest.fn(),
      updatePolicy: jest.fn(),
      deletePolicy: jest.fn(),
    } as jest.Mocked<PolicyClient>;

    TestBed.configureTestingModule({
      providers: [
        PoliciesEffects,
        provideMockActions(() => actions$),
        { provide: PolicyClient, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(PoliciesEffects);
    service = TestBed.inject(PolicyClient) as jest.Mocked<PolicyClient>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = [{ id: '1', name: 'Test' }] as never;
      service.getPolicies.mockReturnValue(of(mockData));

      actions$ = of(PoliciesActions.loadPolicies());

      effects.loadPolicies$.subscribe((action) => {
        expect(action.type).toBe(PoliciesActions.loadPoliciesSuccess.type);
        expect(service.getPolicies).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getPolicies.mockReturnValue(throwError(() => error));

      actions$ = of(PoliciesActions.loadPolicies());

      effects.loadPolicies$.subscribe((action) => {
        expect(action.type).toBe(PoliciesActions.loadPoliciesFailure.type);
        done();
      });
    });
  });
});
