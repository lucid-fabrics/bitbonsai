import { NO_ERRORS_SCHEMA } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import type {
  CapabilityTestProgress,
  CapabilityTestResult,
} from '../../../../core/models/capability-test.model';
import { NetworkLocation } from '../../../../core/models/capability-test.model';
import { CapabilityTestService } from '../../../../core/services/capability-test.service';
import { CapabilityTestComponent } from './capability-test.component';

const MOCK_RESULT: CapabilityTestResult = {
  networkLocation: NetworkLocation.LOCAL,
  hasSharedStorage: true,
  storageBasePath: '/mnt/storage',
  latencyMs: 5,
  bandwidthMbps: 1000,
  isPrivateIP: true,
  reasoning: 'Local network detected',
  tests: {
    networkConnection: { status: 'success', message: 'ok' },
    sharedStorage: { status: 'success', message: 'ok' },
    hardwareDetection: { status: 'success', message: 'ok' },
    networkType: { status: 'success', message: 'ok' },
  },
};

const makeProgress = (overrides: Partial<CapabilityTestProgress> = {}): CapabilityTestProgress => ({
  currentPhase: 2,
  totalPhases: 4,
  progress: 50,
  currentTest: 'Testing shared storage...',
  results: null,
  isComplete: false,
  error: null,
  ...overrides,
});

const makeService = (progress$: ReturnType<typeof of>) => ({
  startTest: jest.fn().mockReturnValue(progress$),
});

describe('CapabilityTestComponent', () => {
  const setup = (progress$: ReturnType<typeof of>) => {
    const mockService = makeService(progress$);

    TestBed.configureTestingModule({
      imports: [CapabilityTestComponent],
      providers: [{ provide: CapabilityTestService, useValue: mockService }],
      schemas: [NO_ERRORS_SCHEMA],
    });

    const fixture = TestBed.createComponent(CapabilityTestComponent);
    fixture.componentInstance.nodeId = 'node-abc';
    return { fixture, component: fixture.componentInstance, mockService };
  };

  it('creates successfully', () => {
    const { component } = setup(of(makeProgress()));
    expect(component).toBeTruthy();
  });

  it('calls startTest with the correct nodeId on init', () => {
    const { fixture, mockService } = setup(of(makeProgress()));
    fixture.detectChanges();
    expect(mockService.startTest).toHaveBeenCalledWith('node-abc');
  });

  it('updates progress signal from stream', () => {
    const { fixture, component } = setup(of(makeProgress({ progress: 75 })));
    fixture.detectChanges();
    expect(component.progress()).toBe(75);
  });

  it('updates currentPhase signal from stream', () => {
    const { fixture, component } = setup(of(makeProgress({ currentPhase: 3 })));
    fixture.detectChanges();
    expect(component.currentPhase()).toBe(3);
  });

  it('sets isComplete and emits testComplete when isComplete arrives', fakeAsync(() => {
    const completeProgress = makeProgress({
      isComplete: true,
      progress: 100,
      results: MOCK_RESULT,
    });
    const { fixture, component } = setup(of(completeProgress));

    const emitted: CapabilityTestResult[] = [];
    component.testComplete.subscribe((r) => emitted.push(r));

    fixture.detectChanges();
    expect(component.isComplete()).toBe(true);

    tick(1000);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(MOCK_RESULT);
  }));

  it('sets errorMessage signal when error arrives in stream', () => {
    const { fixture, component } = setup(throwError(() => ({ message: 'Connection refused' })));
    fixture.detectChanges();
    expect(component.errorMessage()).toBe('Connection refused');
  });
});
