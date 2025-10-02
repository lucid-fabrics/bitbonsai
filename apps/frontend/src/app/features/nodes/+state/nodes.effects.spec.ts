import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';
import { Action } from '@ngrx/store';
import { NodesEffects } from './nodes.effects';
import * as nodesActions from './nodes.actions';
import { NodesService } from '../../../core/services/nodes.service';

describe('NodesEffects', () => {
  let actions$: Observable<Action>;
  let effects: NodesEffects;
  let service: jasmine.SpyObj<NodesService>;

  beforeEach(() => {
    const serviceSpy = jasmine.createSpyObj('NodesService', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        NodesEffects,
        provideMockActions(() => actions$),
        { provide: NodesService, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(NodesEffects);
    service = TestBed.inject(NodesService) as jasmine.SpyObj<NodesService>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = [{ id: '1', name: 'Test' }] as any;
      service.getAll.and.returnValue(of(mockData));

      actions$ = of(nodesActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(nodesActions.loadSuccess.type);
        expect(service.getAll).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getAll.and.returnValue(throwError(() => error));

      actions$ = of(nodesActions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(nodesActions.loadFailure.type);
        done();
      });
    });
  });

  // TODO: Add tests for other effects (create, update, delete)
});
