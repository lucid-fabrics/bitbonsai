import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { type Observable, of, throwError } from 'rxjs';
import { NodesClient } from '../services/nodes.client';
import { NodesActions } from './nodes.actions';
import { NodesEffects } from './nodes.effects';

describe('NodesEffects', () => {
  let actions$: Observable<Action>;
  let effects: NodesEffects;
  let client: jasmine.SpyObj<NodesClient>;

  beforeEach(() => {
    const clientSpy = jasmine.createSpyObj('NodesClient', [
      'getNodes',
      'getNode',
      'register',
      'pair',
      'deleteNode',
    ]);

    TestBed.configureTestingModule({
      providers: [
        NodesEffects,
        provideMockActions(() => actions$),
        { provide: NodesClient, useValue: clientSpy },
      ],
    });

    effects = TestBed.inject(NodesEffects);
    client = TestBed.inject(NodesClient) as jasmine.SpyObj<NodesClient>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('loadNodes$ effect', () => {
    it('should return loadNodesSuccess action on success', (done) => {
      const mockNodes = [{ id: '1', name: 'Test Node' }] as never;
      client.getNodes.and.returnValue(of(mockNodes));

      actions$ = of(NodesActions.loadNodes());

      effects.loadNodes$.subscribe((action) => {
        expect(action.type).toBe(NodesActions.loadNodesSuccess.type);
        expect(client.getNodes).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadNodesFailure action on error', (done) => {
      const error = new Error('Load failed');
      client.getNodes.and.returnValue(throwError(() => error));

      actions$ = of(NodesActions.loadNodes());

      effects.loadNodes$.subscribe((action) => {
        expect(action.type).toBe(NodesActions.loadNodesFailure.type);
        done();
      });
    });
  });

  // TODO: Add tests for registerNode$, pairNode$, deleteNode$ effects
});
