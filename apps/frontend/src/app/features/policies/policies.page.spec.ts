import { Dialog, type DialogRef } from '@angular/cdk/dialog';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { configureFontAwesome } from '../../core/config/font-awesome.config';
import { ConfirmationDialogComponent } from '../../shared/components/confirmation-dialog/confirmation-dialog.component';
import { PoliciesActions } from './+state/policies.actions';
import type { PolicyBo } from './bos/policy.bo';
import {
  AudioHandling,
  DeviceProfile,
  PolicyPreset,
  type PresetInfoModel,
  TargetCodec,
} from './models/policy.model';
import { PoliciesComponent } from './policies.page';

describe('PoliciesComponent', () => {
  let component: PoliciesComponent;
  let fixture: ComponentFixture<PoliciesComponent>;
  let store: MockStore;
  let dialog: jest.Mocked<Dialog>;
  let httpMock: HttpTestingController;

  const mockPolicy: PolicyBo = {
    id: '1',
    name: 'Test Policy',
    preset: PolicyPreset.BALANCED_HEVC,
    targetCodec: TargetCodec.HEVC,
    targetQuality: 23,
    libraryId: 'lib-1',
    deviceProfiles: [DeviceProfile.APPLE_TV, DeviceProfile.WEB],
    ffmpegFlags: '-preset medium',
    audioHandling: AudioHandling.COPY,
  } as PolicyBo;

  const mockPreset: PresetInfoModel = {
    name: 'Balanced HEVC',
    preset: PolicyPreset.BALANCED_HEVC,
    codec: TargetCodec.HEVC,
    crf: 23,
    description: 'Balanced quality',
  };

  const mockDialog = {
    open: jest.fn(),
  };

  const initialState = {
    policies: {
      policies: [],
      presets: [],
      loading: false,
      error: null,
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PoliciesComponent],
      providers: [
        provideMockStore({ initialState }),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Dialog, useValue: mockDialog },
      ],
    }).compileComponents();

    const library = TestBed.inject(FaIconLibrary);
    configureFontAwesome(library);

    fixture = TestBed.createComponent(PoliciesComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(MockStore);
    dialog = TestBed.inject(Dialog) as jest.Mocked<Dialog>;
    httpMock = TestBed.inject(HttpTestingController);

    jest.clearAllMocks();
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('Component Initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should dispatch load actions on init', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      fixture.detectChanges();

      expect(dispatchSpy).toHaveBeenCalledWith(PoliciesActions.loadPolicies());
      expect(dispatchSpy).toHaveBeenCalledWith(PoliciesActions.loadPresets());
    });

    it('should initialize form state signals', () => {
      expect(component.showFormModal()).toBe(false);
      expect(component.isEditMode()).toBe(false);
      expect(component.editingPolicyId()).toBeNull();
      expect(component.showAdvancedSettings()).toBe(false);
    });
  });

  describe('selectPreset', () => {
    it('should populate form with preset data', () => {
      component.selectPreset(mockPreset);

      const formData = component.formData();
      expect(formData.name).toBe('Balanced HEVC');
      expect(formData.preset).toBe(PolicyPreset.BALANCED_HEVC);
      expect(formData.targetCodec).toBe(TargetCodec.HEVC);
      expect(formData.targetQuality).toBe(23);
      expect(component.showFormModal()).toBe(true);
      expect(component.isEditMode()).toBe(false);
    });
  });

  describe('openCreateForm', () => {
    it('should reset form and open modal', () => {
      component.openCreateForm();

      expect(component.showFormModal()).toBe(true);
      expect(component.isEditMode()).toBe(false);
      expect(component.showAdvancedSettings()).toBe(false);
      expect(component.formErrors()).toEqual({});

      const formData = component.formData();
      expect(formData.name).toBe('');
      expect(formData.preset).toBe(PolicyPreset.CUSTOM);
      expect(formData.targetQuality).toBe(23);
    });
  });

  describe('openEditForm', () => {
    it('should populate form with policy data', () => {
      component.openEditForm(mockPolicy);

      const formData = component.formData();
      expect(formData.name).toBe('Test Policy');
      expect(formData.preset).toBe(PolicyPreset.BALANCED_HEVC);
      expect(formData.targetCodec).toBe(TargetCodec.HEVC);
      expect(formData.targetQuality).toBe(23);
      expect(formData.libraryId).toBe('lib-1');
      expect(formData.deviceProfiles).toEqual(new Set([DeviceProfile.APPLE_TV, DeviceProfile.WEB]));
      expect(formData.ffmpegFlags).toBe('-preset medium');
      expect(formData.audioHandling).toBe(AudioHandling.COPY);
      expect(component.showFormModal()).toBe(true);
      expect(component.isEditMode()).toBe(true);
      expect(component.editingPolicyId()).toBe('1');
    });

    it('should handle policy without optional fields', () => {
      const minimalPolicy = {
        ...mockPolicy,
        libraryId: null,
        ffmpegFlags: null,
        audioHandling: null,
      } as PolicyBo;

      component.openEditForm(minimalPolicy);

      const formData = component.formData();
      expect(formData.libraryId).toBe('');
      expect(formData.ffmpegFlags).toBe('');
      expect(formData.audioHandling).toBe(AudioHandling.COPY);
    });
  });

  describe('closeForm', () => {
    it('should reset all form state', () => {
      component.showFormModal.set(true);
      component.isEditMode.set(true);
      component.editingPolicyId.set('1');
      component.showAdvancedSettings.set(true);

      component.closeForm();

      expect(component.showFormModal()).toBe(false);
      expect(component.isEditMode()).toBe(false);
      expect(component.editingPolicyId()).toBeNull();
      expect(component.showAdvancedSettings()).toBe(false);
    });
  });

  describe('toggleDeviceProfile', () => {
    it('should add profile if not present', () => {
      const formData = component.formData();
      formData.deviceProfiles = new Set();
      component.formData.set(formData);

      component.toggleDeviceProfile(DeviceProfile.APPLE_TV);

      expect(component.formData().deviceProfiles.has(DeviceProfile.APPLE_TV)).toBe(true);
    });

    it('should remove profile if present', () => {
      const formData = component.formData();
      formData.deviceProfiles = new Set([DeviceProfile.APPLE_TV]);
      component.formData.set(formData);

      component.toggleDeviceProfile(DeviceProfile.APPLE_TV);

      expect(component.formData().deviceProfiles.has(DeviceProfile.APPLE_TV)).toBe(false);
    });
  });

  describe('getCRFLabel', () => {
    it('should return Excellent for crf <= 20', () => {
      expect(component.getCRFLabel(18)).toBe('Excellent');
      expect(component.getCRFLabel(20)).toBe('Excellent');
    });

    it('should return Good for crf 21-25', () => {
      expect(component.getCRFLabel(23)).toBe('Good');
      expect(component.getCRFLabel(25)).toBe('Good');
    });

    it('should return Fast for crf > 25', () => {
      expect(component.getCRFLabel(28)).toBe('Fast');
      expect(component.getCRFLabel(35)).toBe('Fast');
    });
  });

  describe('validateForm', () => {
    it('should validate empty name', () => {
      const formData = component.formData();
      formData.name = '';
      formData.deviceProfiles = new Set([DeviceProfile.WEB]);
      component.formData.set(formData);

      const isValid = component.validateForm();

      expect(isValid).toBe(false);
      expect(component.formErrors().name).toBe('Name is required');
    });

    it('should validate name length', () => {
      const formData = component.formData();
      formData.name = 'a'.repeat(51);
      formData.deviceProfiles = new Set([DeviceProfile.WEB]);
      component.formData.set(formData);

      const isValid = component.validateForm();

      expect(isValid).toBe(false);
      expect(component.formErrors().name).toBe('Name must be 50 characters or less');
    });

    it('should validate quality range', () => {
      const formData = component.formData();
      formData.name = 'Valid Name';
      formData.targetQuality = 52;
      formData.deviceProfiles = new Set([DeviceProfile.WEB]);
      component.formData.set(formData);

      const isValid = component.validateForm();

      expect(isValid).toBe(false);
      expect(component.formErrors().targetQuality).toBe('Quality must be between 0 and 51');
    });

    it('should validate device profiles', () => {
      const formData = component.formData();
      formData.name = 'Valid Name';
      formData.targetQuality = 23;
      formData.deviceProfiles = new Set();
      component.formData.set(formData);

      const isValid = component.validateForm();

      expect(isValid).toBe(false);
      expect(component.formErrors().deviceProfiles).toBe(
        'At least one device profile must be selected'
      );
    });

    it('should return true for valid form', () => {
      const formData = component.formData();
      formData.name = 'Valid Policy';
      formData.targetQuality = 23;
      formData.deviceProfiles = new Set([DeviceProfile.WEB]);
      component.formData.set(formData);

      const isValid = component.validateForm();

      expect(isValid).toBe(true);
      expect(component.formErrors()).toEqual({});
    });
  });

  describe('submitForm', () => {
    beforeEach(() => {
      const formData = component.formData();
      formData.name = 'New Policy';
      formData.preset = PolicyPreset.BALANCED_HEVC;
      formData.targetCodec = TargetCodec.HEVC;
      formData.targetQuality = 23;
      formData.libraryId = 'lib-1';
      formData.deviceProfiles = new Set([DeviceProfile.APPLE_TV, DeviceProfile.WEB]);
      formData.ffmpegFlags = '-preset medium';
      formData.audioHandling = AudioHandling.COPY;
      component.formData.set(formData);
    });

    it('should not submit invalid form', () => {
      const formData = component.formData();
      formData.name = '';
      component.formData.set(formData);
      const dispatchSpy = jest.spyOn(store, 'dispatch');

      component.submitForm();

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should dispatch createPolicy for new policy', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      component.isEditMode.set(false);

      component.submitForm();

      expect(dispatchSpy).toHaveBeenCalledWith(
        PoliciesActions.createPolicy({
          request: expect.objectContaining({
            name: 'New Policy',
            preset: PolicyPreset.BALANCED_HEVC,
            targetCodec: TargetCodec.HEVC,
            targetQuality: 23,
            libraryId: 'lib-1',
            deviceProfiles: {
              appleTV: true,
              chromecast: false,
              roku: false,
              web: true,
            },
            advancedSettings: {
              ffmpegFlags: '-preset medium',
              audioHandling: AudioHandling.COPY,
            },
          }),
        })
      );
      expect(component.showFormModal()).toBe(false);
    });

    it('should dispatch updatePolicy for existing policy', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      component.isEditMode.set(true);
      component.editingPolicyId.set('policy-1');

      component.submitForm();

      expect(dispatchSpy).toHaveBeenCalledWith(
        PoliciesActions.updatePolicy({
          id: 'policy-1',
          request: expect.objectContaining({
            name: 'New Policy',
          }),
        })
      );
      expect(component.showFormModal()).toBe(false);
    });

    it('should not submit update without policy id', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      component.isEditMode.set(true);
      component.editingPolicyId.set(null);

      component.submitForm();

      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('confirmDelete', () => {
    it('should open confirmation dialog', () => {
      const mockDialogRef = {
        closed: of(false),
      } as DialogRef<boolean>;
      mockDialog.open.mockReturnValue(mockDialogRef);

      component.confirmDelete(mockPolicy);

      expect(mockDialog.open).toHaveBeenCalledWith(
        ConfirmationDialogComponent,
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Delete Policy?',
            itemName: 'Test Policy',
            irreversible: true,
          }),
        })
      );
    });

    it('should dispatch deletePolicy when confirmed', () => {
      const mockDialogRef = {
        closed: of(true),
      } as DialogRef<boolean>;
      mockDialog.open.mockReturnValue(mockDialogRef);
      const dispatchSpy = jest.spyOn(store, 'dispatch');

      component.confirmDelete(mockPolicy);

      expect(dispatchSpy).toHaveBeenCalledWith(PoliciesActions.deletePolicy({ id: '1' }));
    });

    it('should not dispatch deletePolicy when cancelled', () => {
      const mockDialogRef = {
        closed: of(false),
      } as DialogRef<boolean>;
      mockDialog.open.mockReturnValue(mockDialogRef);
      const dispatchSpy = jest.spyOn(store, 'dispatch');

      component.confirmDelete(mockPolicy);

      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('getDeviceLabel', () => {
    it('should replace underscores with spaces', () => {
      expect(component.getDeviceLabel(DeviceProfile.APPLE_TV)).toBe('APPLE TV');
      expect(component.getDeviceLabel(DeviceProfile.WEB)).toBe('WEB');
    });
  });

  describe('getDeviceProfileExplanation', () => {
    it('should return correct explanations', () => {
      expect(component.getDeviceProfileExplanation(DeviceProfile.APPLE_TV)).toContain('Apple TV');
      expect(component.getDeviceProfileExplanation(DeviceProfile.ROKU)).toContain('Roku');
      expect(component.getDeviceProfileExplanation(DeviceProfile.WEB)).toContain('web browser');
      expect(component.getDeviceProfileExplanation(DeviceProfile.CHROMECAST)).toContain(
        'Chromecast'
      );
    });

    it('should return default for unknown profile', () => {
      expect(component.getDeviceProfileExplanation('UNKNOWN' as DeviceProfile)).toContain(
        'Device-specific'
      );
    });
  });

  describe('getPresetIcon', () => {
    it('should return correct icons', () => {
      expect(component.getPresetIcon(PolicyPreset.BALANCED_HEVC)).toBe('⚖️');
      expect(component.getPresetIcon(PolicyPreset.FAST_HEVC)).toBe('⚡');
      expect(component.getPresetIcon(PolicyPreset.QUALITY_AV1)).toBe('💎');
      expect(component.getPresetIcon(PolicyPreset.COPY_IF_COMPLIANT)).toBe('✅');
      expect(component.getPresetIcon(PolicyPreset.CUSTOM)).toBe('🔧');
    });

    it('should return default icon for unknown preset', () => {
      expect(component.getPresetIcon('UNKNOWN' as PolicyPreset)).toBe('📋');
    });
  });
});
