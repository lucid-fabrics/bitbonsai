import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { type Observable, of, throwError } from 'rxjs';
import { QueueClient } from '../services/queue.client';
import { QueueActions } from './queue.actions';
import { QueueEffects } from './queue.effects';

describe('QueueEffects', () => {
  let actions$: Observable<Action>;
  let effects: QueueEffects;
  let service: jest.Mocked<QueueClient>;

  beforeEach(() => {
    const serviceMock = {
      getQueue: jest.fn(),
      cancelJob: jest.fn(),
      retryJob: jest.fn(),
    } as unknown as jest.Mocked<QueueClient>;

    TestBed.configureTestingModule({
      providers: [
        QueueEffects,
        provideMockActions(() => actions$),
        { provide: QueueClient, useValue: serviceMock },
      ],
    });

    effects = TestBed.inject(QueueEffects);
    service = TestBed.inject(QueueClient) as jest.Mocked<QueueClient>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = {
        jobs: [],
        stats: { queued: 0, encoding: 0, completed: 0, failed: 0, totalSavedBytes: '0' },
      } as never;
      service.getQueue.mockReturnValue(of(mockData));

      actions$ = of(QueueActions.loadQueue({ filters: undefined }));

      effects.loadQueue$.subscribe((action) => {
        expect(action.type).toBe(QueueActions.loadQueueSuccess.type);
        expect(service.getQueue).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getQueue.mockReturnValue(throwError(() => error));

      actions$ = of(QueueActions.loadQueue({ filters: undefined }));

      effects.loadQueue$.subscribe((action) => {
        expect(action.type).toBe(QueueActions.loadQueueFailure.type);
        done();
      });
    });
  });
});
