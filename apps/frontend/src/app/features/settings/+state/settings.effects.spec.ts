import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';
import { Action } from '@ngrx/store';
import { SettingsEffects } from './settings.effects';
import * as settingsActions from './settings.actions';
import { SettingsService } from '../../../core/services/settings.service';

describe('SettingsEffects', () => {
  let actions$: Observable<Action>;
  let effects: SettingsEffects;
  let service: jasmine.SpyObj<SettingsService>;

  beforeEach(() => {
    const serviceSpy = jasmine.createSpyObj('SettingsService', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        SettingsEffects,
        provideMockActions(() => actions$),
        { provide: SettingsService, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(SettingsEffects);
    service = TestBed.inject(SettingsService) as jasmine.SpyObj<SettingsService>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = [{ id: '1', name: 'Test' }] as any;
      service.getAll.and.returnValue(of(mockData));

      actions$ = of(settingsActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(settingsActions.loadSuccess.type);
        expect(service.getAll).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getAll.and.returnValue(throwError(() => error));

      actions$ = of(settingsActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(settingsActions.loadFailure.type);
        done();
      });
    });
  });

  // TODO: Add tests for other effects (create, update, delete)
});
