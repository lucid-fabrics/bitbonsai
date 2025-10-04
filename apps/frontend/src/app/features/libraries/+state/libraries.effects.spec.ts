import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { type Observable, of, throwError } from 'rxjs';
import { LibrariesClient } from '../services/libraries.client';
import * as librariesActions from './libraries.actions';
import { LibrariesEffects } from './libraries.effects';

describe('LibrariesEffects', () => {
  let actions$: Observable<Action>;
  let effects: LibrariesEffects;
  let service: jasmine.SpyObj<LibrariesClient>;

  beforeEach(() => {
    const serviceSpy = jasmine.createSpyObj('LibrariesClient', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        LibrariesEffects,
        provideMockActions(() => actions$),
        { provide: LibrariesClient, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(LibrariesEffects);
    service = TestBed.inject(LibrariesClient) as jasmine.SpyObj<LibrariesClient>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = [{ id: '1', name: 'Test' }] as any;
      service.getAll.and.returnValue(of(mockData));

      actions$ = of(librariesActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(librariesActions.loadSuccess.type);
        expect(service.getAll).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getAll.and.returnValue(throwError(() => error));

      actions$ = of(librariesActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(librariesActions.loadFailure.type);
        done();
      });
    });
  });

  // TODO: Add tests for other effects (create, update, delete)
});
