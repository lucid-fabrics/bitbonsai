import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { type Observable, of, throwError } from 'rxjs';
import { LibrariesClient } from '../services/libraries.client';
import { LibrariesActions } from './libraries.actions';
import { LibrariesEffects } from './libraries.effects';

describe('LibrariesEffects', () => {
  let actions$: Observable<Action>;
  let effects: LibrariesEffects;
  let service: jest.Mocked<LibrariesClient>;

  beforeEach(() => {
    const serviceSpy = {
      getLibraries: jest.fn(),
      getLibrary: jest.fn(),
      createLibrary: jest.fn(),
      updateLibrary: jest.fn(),
      deleteLibrary: jest.fn(),
      scanLibrary: jest.fn(),
    } as jest.Mocked<LibrariesClient>;

    TestBed.configureTestingModule({
      providers: [
        LibrariesEffects,
        provideMockActions(() => actions$),
        { provide: LibrariesClient, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(LibrariesEffects);
    service = TestBed.inject(LibrariesClient) as jest.Mocked<LibrariesClient>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = [{ id: '1', name: 'Test' }] as never;
      service.getLibraries.mockReturnValue(of(mockData));

      actions$ = of(LibrariesActions.loadLibraries());

      effects.loadLibraries$.subscribe((action) => {
        expect(action.type).toBe(LibrariesActions.loadLibrariesSuccess.type);
        expect(service.getLibraries).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getLibraries.mockReturnValue(throwError(() => error));

      actions$ = of(LibrariesActions.loadLibraries());

      effects.loadLibraries$.subscribe((action) => {
        expect(action.type).toBe(LibrariesActions.loadLibrariesFailure.type);
        done();
      });
    });
  });
});
