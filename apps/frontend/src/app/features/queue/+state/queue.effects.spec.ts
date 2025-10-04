import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { type Observable, of, throwError } from 'rxjs';
import { QueueClient } from '../services/queue.client';
import * as queueActions from './queue.actions';
import { QueueEffects } from './queue.effects';

describe('QueueEffects', () => {
  let actions$: Observable<Action>;
  let effects: QueueEffects;
  let service: jasmine.SpyObj<QueueClient>;

  beforeEach(() => {
    const serviceSpy = jasmine.createSpyObj('QueueClient', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        QueueEffects,
        provideMockActions(() => actions$),
        { provide: QueueClient, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(QueueEffects);
    service = TestBed.inject(QueueClient) as jasmine.SpyObj<QueueClient>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = [{ id: '1', name: 'Test' }] as any;
      service.getAll.and.returnValue(of(mockData));

      actions$ = of(queueActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(queueActions.loadSuccess.type);
        expect(service.getAll).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getAll.and.returnValue(throwError(() => error));

      actions$ = of(queueActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(queueActions.loadFailure.type);
        done();
      });
    });
  });

  // TODO: Add tests for other effects (create, update, delete)
});
