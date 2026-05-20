import { NO_ERRORS_SCHEMA } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { of, throwError } from 'rxjs';
import { configureFontAwesome } from '../../core/config/font-awesome.config';
import { NodeSetupWizardComponent } from './node-setup-wizard.component';
import { NodeSetupService } from './services/node-setup.service';

describe('NodeSetupWizardComponent', () => {
  let component: NodeSetupWizardComponent;
  let fixture: ComponentFixture<NodeSetupWizardComponent>;
  let nodeSetupService: jest.Mocked<NodeSetupService>;
  let router: jest.Mocked<Router>;

  beforeEach(async () => {
    nodeSetupService = {
      loadPendingPairingState: jest.fn().mockReturnValue(null),
      startScan: jest.fn(),
      initiatePairing: jest.fn(),
      pollPairingStatus: jest.fn(),
      getRegistrationRequest: jest.fn(),
      setMainNodeUrl: jest.fn(),
      getMainNodeUrl: jest.fn().mockReturnValue(null),
      buildMainNodeUrl: jest.fn().mockReturnValue('http://192.168.1.100:3100'),
      completeSetup: jest.fn(),
      getHardwareDetection: jest.fn(),
      finalizeCapabilityConfig: jest.fn(),
      savePendingPairingState: jest.fn(),
      clearPendingPairingState: jest.fn(),
      reset: jest.fn(),
    } as unknown as jest.Mocked<NodeSetupService>;

    router = { navigate: jest.fn() } as unknown as jest.Mocked<Router>;

    await TestBed.configureTestingModule({
      imports: [NodeSetupWizardComponent, TranslocoTestingModule.forRoot({})],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: NodeSetupService, useValue: nodeSetupService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    configureFontAwesome(TestBed.inject(FaIconLibrary));

    fixture = TestBed.createComponent(NodeSetupWizardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initial signal values', () => {
    it('starts at WizardStep.Welcome (0)', () => {
      expect(component.currentStep()).toBe(0);
    });

    it('has no pairing method selected', () => {
      expect(component.pairingMethod()).toBeNull();
    });

    it('has isLoading false', () => {
      expect(component.isLoading()).toBe(false);
    });

    it('has no error message', () => {
      expect(component.errorMessage()).toBeNull();
    });

    it('has empty discoveredNodes', () => {
      expect(component.discoveredNodes()).toEqual([]);
    });

    it('canProceedToSelection is false with no discovered nodes', () => {
      expect(component.canProceedToSelection()).toBe(false);
    });
  });

  describe('startWizard', () => {
    it('advances to WizardStep.ChooseMethod (1)', () => {
      component.startWizard();
      expect(component.currentStep()).toBe(1);
    });

    it('clears any existing error message', () => {
      component.errorMessage.set('some error');
      component.startWizard();
      expect(component.errorMessage()).toBeNull();
    });
  });

  describe('selectPairingMethod', () => {
    it('sets ManualCode and advances to ManualCode step (3)', () => {
      component.startWizard();
      component.selectPairingMethod('manual-code' as never);
      expect(component.currentStep()).toBe(3);
      expect(component.pairingMethod()).toBe('manual-code');
    });

    it('sets AutoDiscovery, calls startScan, and advances to Scanning step (2)', () => {
      nodeSetupService.startScan.mockReturnValue(of({ nodes: [], scanDurationMs: 500 }));
      component.startWizard();
      component.selectPairingMethod('auto-discovery' as never);
      expect(component.currentStep()).toBe(2);
      expect(nodeSetupService.startScan).toHaveBeenCalled();
    });
  });

  describe('selectNode', () => {
    it('sets selectedNodeId signal', () => {
      component.selectNode('node-abc');
      expect(component.selectedNodeId()).toBe('node-abc');
    });
  });

  describe('goBack', () => {
    it('returns to ChooseMethod from Scanning step', () => {
      component.currentStep.set(2); // Scanning
      component.goBack();
      expect(component.currentStep()).toBe(1); // ChooseMethod
    });

    it('returns to ChooseMethod from ManualCode step', () => {
      component.currentStep.set(3); // ManualCode
      component.goBack();
      expect(component.currentStep()).toBe(1); // ChooseMethod
    });
  });

  describe('completeWizard', () => {
    it('navigates to /queue', () => {
      component.completeWizard();
      expect(router.navigate).toHaveBeenCalledWith(['/queue']);
    });
  });

  describe('proceedWithManualCode validation', () => {
    it('sets errorMessage when pairing code is not 6 digits', () => {
      component.manualPairingCode.set('123');
      component.proceedWithManualCode();
      expect(component.errorMessage()).toContain('6-digit');
    });

    it('sets errorMessage when node URL is empty', () => {
      component.manualPairingCode.set('123456');
      component.manualMainNodeUrl.set('');
      component.proceedWithManualCode();
      expect(component.errorMessage()).toContain('main node URL');
    });

    it('advances to SelectNode when both inputs are valid', () => {
      component.manualPairingCode.set('123456');
      component.manualMainNodeUrl.set('http://192.168.1.100:3100');
      component.proceedWithManualCode();
      expect(component.currentStep()).toBe(4); // SelectNode
    });
  });

  describe('handleCapabilityTestComplete', () => {
    it('stores results and advances to CapabilityResults step (7)', () => {
      const mockResults = { passed: true } as never;
      component.handleCapabilityTestComplete(mockResults);
      expect(component.capabilityTestResults()).toBe(mockResults);
      expect(component.currentStep()).toBe(7);
    });
  });

  describe('handleCapabilityResultsBack', () => {
    it('returns to CapabilityTest step (6)', () => {
      component.currentStep.set(7);
      component.handleCapabilityResultsBack();
      expect(component.currentStep()).toBe(6);
    });
  });

  describe('ngOnInit with pending pairing state', () => {
    it('resumes pairing step when a PENDING request exists', () => {
      nodeSetupService.loadPendingPairingState.mockReturnValue({
        requestId: 'req-1',
        pairingCode: 'ABC123',
        mainNodeUrl: 'http://192.168.1.100:3100',
      });
      nodeSetupService.getRegistrationRequest.mockReturnValue(
        of({ status: 'PENDING', requestId: 'req-1' } as never)
      );
      nodeSetupService.pollPairingStatus.mockReturnValue(of());

      component.ngOnInit();

      expect(component.currentStep()).toBe(5); // Pairing
      expect(component.pairingCode()).toBe('ABC123');
    });

    it('clears state when the pending request is no longer PENDING', () => {
      nodeSetupService.loadPendingPairingState.mockReturnValue({
        requestId: 'req-1',
        pairingCode: 'ABC123',
        mainNodeUrl: 'http://192.168.1.100:3100',
      });
      nodeSetupService.getRegistrationRequest.mockReturnValue(
        of({ status: 'APPROVED', requestId: 'req-1' } as never)
      );

      component.ngOnInit();

      expect(nodeSetupService.clearPendingPairingState).toHaveBeenCalled();
      expect(component.currentStep()).toBe(0); // stays at Welcome
    });

    it('clears state on getRegistrationRequest error', () => {
      nodeSetupService.loadPendingPairingState.mockReturnValue({
        requestId: 'req-1',
        pairingCode: 'ABC123',
        mainNodeUrl: 'http://192.168.1.100:3100',
      });
      nodeSetupService.getRegistrationRequest.mockReturnValue(throwError(() => new Error('fail')));

      component.ngOnInit();

      expect(nodeSetupService.clearPendingPairingState).toHaveBeenCalled();
    });
  });
});
