import { NO_ERRORS_SCHEMA } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { of, throwError } from 'rxjs';
import { SetupService } from '../../core/services/setup.service';
import { CloudAccountService } from '../settings/services/cloud-account.service';
import { SetupComponent } from './setup.page';

describe('SetupComponent', () => {
  let component: SetupComponent;
  let fixture: ComponentFixture<SetupComponent>;
  let setupService: jest.Mocked<SetupService>;
  let cloudAccountService: jest.Mocked<CloudAccountService>;
  let router: jest.Mocked<Router>;

  beforeEach(async () => {
    setupService = {
      initializeSetup: jest.fn(),
    } as unknown as jest.Mocked<SetupService>;

    cloudAccountService = {
      startDeviceFlow: jest.fn(),
      getStatus: jest.fn(),
    } as unknown as jest.Mocked<CloudAccountService>;

    router = {
      navigate: jest.fn(),
    } as unknown as jest.Mocked<Router>;

    await TestBed.configureTestingModule({
      imports: [SetupComponent, ReactiveFormsModule, TranslocoTestingModule.forRoot({})],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideNoopAnimations(),
        { provide: SetupService, useValue: setupService },
        { provide: CloudAccountService, useValue: cloudAccountService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SetupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initial state', () => {
    it('should start at step 0 (Welcome)', () => {
      expect(component.currentStep()).toBe(0);
    });

    it('should have isLoading false', () => {
      expect(component.isLoading()).toBe(false);
    });

    it('should have no error message', () => {
      expect(component.errorMessage()).toBeNull();
    });

    it('should have totalSteps of 5 for main node by default', () => {
      expect(component.totalSteps).toBe(5);
    });
  });

  describe('step navigation', () => {
    it('nextStep() increments step from Welcome to NodeType', () => {
      component.nextStep();
      expect(component.currentStep()).toBe(1);
    });

    it('previousStep() does not go below step 0', () => {
      component.previousStep();
      expect(component.currentStep()).toBe(0);
    });

    it('previousStep() decrements step when past Welcome', () => {
      component.nextStep(); // to NodeType
      component.previousStep();
      expect(component.currentStep()).toBe(0);
    });

    it('nextStep() navigates child node to /node-setup at LocalNetworkAccess step', () => {
      component.nodeTypeForm.get('nodeType')?.setValue('child');
      // advance to LocalNetworkAccess (step 2)
      component.nextStep(); // Welcome -> NodeType
      component.nextStep(); // NodeType -> LocalNetworkAccess
      component.nextStep(); // triggers router.navigate for child
      expect(router.navigate).toHaveBeenCalledWith(['/node-setup']);
    });
  });

  describe('form validation', () => {
    it('adminForm is invalid when empty', () => {
      expect(component.adminForm.invalid).toBe(true);
    });

    it('hasError returns false for untouched empty field', () => {
      expect(component.hasError('username')).toBe(false);
    });

    it('hasError returns true for touched invalid field', () => {
      component.adminForm.get('username')?.markAsTouched();
      expect(component.hasError('username')).toBe(true);
    });

    it('getErrorMessage returns required message for empty username', () => {
      component.adminForm.get('username')?.markAsTouched();
      expect(component.getErrorMessage('username')).toContain('required');
    });

    it('passwordsMatch returns true when passwords are equal', () => {
      component.adminForm.patchValue({ password: 'secret123', confirmPassword: 'secret123' });
      expect(component.passwordsMatch).toBe(true);
    });

    it('passwordsMatch returns false when passwords differ', () => {
      component.adminForm.patchValue({ password: 'secret123', confirmPassword: 'different' });
      expect(component.passwordsMatch).toBe(false);
    });
  });

  describe('password visibility toggles', () => {
    it('togglePasswordVisibility flips showPassword signal', () => {
      expect(component.showPassword()).toBe(false);
      component.togglePasswordVisibility();
      expect(component.showPassword()).toBe(true);
    });

    it('toggleConfirmPasswordVisibility flips showConfirmPassword signal', () => {
      expect(component.showConfirmPassword()).toBe(false);
      component.toggleConfirmPasswordVisibility();
      expect(component.showConfirmPassword()).toBe(true);
    });
  });

  describe('submitSetup', () => {
    it('marks form as touched and aborts when adminForm is invalid', () => {
      component.submitSetup();
      expect(setupService.initializeSetup).not.toHaveBeenCalled();
      expect(component.adminForm.touched).toBe(true);
    });

    it('sets errorMessage on 409 conflict', () => {
      component.adminForm.patchValue({
        username: 'admin',
        password: 'password1',
        confirmPassword: 'password1',
      });
      setupService.initializeSetup.mockReturnValue(throwError(() => ({ status: 409 })));

      component.submitSetup();

      expect(component.errorMessage()).toContain('already been completed');
    });
  });

  describe('skipCloudLink', () => {
    it('navigates away when skipCloudLink is called', () => {
      component.skipCloudLink();
      expect(router.navigate).toHaveBeenCalledWith(['/']);
    });
  });
});
