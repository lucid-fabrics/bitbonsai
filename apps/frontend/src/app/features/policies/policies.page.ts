import { Dialog } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faCheck,
  faEdit,
  faPlus,
  faStar,
  faTimes,
  faTrash,
  faTv,
} from '@fortawesome/pro-solid-svg-icons';
import { Store } from '@ngrx/store';
import {
  ConfirmationDialogComponent,
  type ConfirmationDialogData,
} from '../../shared/components/confirmation-dialog/confirmation-dialog.component';
import { RichTooltipDirective } from '../../shared/directives/rich-tooltip.directive';
import type { EnvironmentInfo } from '../settings/models/settings.model';
import { SettingsService } from '../settings/services/settings.service';
import { PoliciesActions } from './+state/policies.actions';
import { PoliciesSelectors } from './+state/policies.selectors';
import type { PolicyBo } from './bos/policy.bo';
import {
  AudioHandling,
  type CreatePolicyRequest,
  DeviceProfile,
  HardwareAcceleration,
  PolicyPreset,
  type PresetInfoModel,
  TargetCodec,
} from './models/policy.model';

interface PolicyFormData {
  name: string;
  preset: PolicyPreset;
  targetCodec: TargetCodec;
  targetQuality: number;
  libraryId: string;
  deviceProfiles: Set<DeviceProfile>;
  ffmpegFlags: string;
  audioHandling: AudioHandling;
  hardwareAcceleration: HardwareAcceleration;
}

@Component({
  selector: 'app-policies',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule, FormsModule, RichTooltipDirective],
  templateUrl: './policies.page.html',
  styleUrls: ['./policies.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoliciesComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly dialog = inject(Dialog);
  private readonly settingsService = inject(SettingsService);

  // Icons
  readonly icons = {
    star: faStar,
    plus: faPlus,
    edit: faEdit,
    trash: faTrash,
    times: faTimes,
    check: faCheck,
    tv: faTv,
  };

  // Enums for template
  readonly PolicyPreset = PolicyPreset;
  readonly TargetCodec = TargetCodec;
  readonly DeviceProfile = DeviceProfile;
  readonly AudioHandling = AudioHandling;
  readonly HardwareAcceleration = HardwareAcceleration;

  // NgRx State
  readonly policies$ = this.store.select(PoliciesSelectors.selectPolicies);
  readonly presets$ = this.store.select(PoliciesSelectors.selectPresets);
  readonly isLoading$ = this.store.select(PoliciesSelectors.selectIsLoading);
  readonly error$ = this.store.select(PoliciesSelectors.selectError);

  // Local Form State (signals for OnPush change detection)
  showFormModal = signal(false);
  isEditMode = signal(false);
  editingPolicyId = signal<string | null>(null);
  showAdvancedSettings = signal(false);
  formData = signal<PolicyFormData>(this.getEmptyFormData());
  formErrors = signal<Record<string, string>>({});
  environmentInfo = signal<EnvironmentInfo | null>(null);

  ngOnInit(): void {
    this.store.dispatch(PoliciesActions.loadPolicies());
    this.store.dispatch(PoliciesActions.loadPresets());
    this.loadEnvironmentInfo();
  }

  private loadEnvironmentInfo(): void {
    this.settingsService.getEnvironmentInfo().subscribe({
      next: (info) => {
        this.environmentInfo.set(info);
      },
      error: (err) => {
        console.error('Failed to load environment info:', err);
      },
    });
  }

  selectPreset(preset: PresetInfoModel): void {
    this.formData.set({
      ...this.formData(),
      preset: preset.preset,
      targetCodec: preset.codec,
      targetQuality: preset.crf,
      name: preset.name,
    });
    this.showFormModal.set(true);
    this.isEditMode.set(false);
  }

  openCreateForm(): void {
    this.formData.set(this.getEmptyFormData());
    this.formErrors.set({});
    this.showFormModal.set(true);
    this.isEditMode.set(false);
    this.showAdvancedSettings.set(false);
  }

  openEditForm(policy: PolicyBo): void {
    this.formData.set({
      name: policy.name,
      preset: policy.preset,
      targetCodec: policy.targetCodec,
      targetQuality: policy.targetQuality,
      libraryId: policy.libraryId || '',
      deviceProfiles: new Set(policy.deviceProfiles),
      ffmpegFlags: policy.ffmpegFlags || '',
      audioHandling: policy.audioHandling || AudioHandling.COPY,
      hardwareAcceleration: policy.hardwareAcceleration || HardwareAcceleration.CPU,
    });
    this.formErrors.set({});
    this.editingPolicyId.set(policy.id);
    this.showFormModal.set(true);
    this.isEditMode.set(true);
    this.showAdvancedSettings.set(false);
  }

  closeForm(): void {
    this.showFormModal.set(false);
    this.isEditMode.set(false);
    this.editingPolicyId.set(null);
    this.showAdvancedSettings.set(false);
  }

  toggleDeviceProfile(profile: DeviceProfile): void {
    const currentData = this.formData();
    const profiles = new Set(currentData.deviceProfiles);
    if (profiles.has(profile)) {
      profiles.delete(profile);
    } else {
      profiles.add(profile);
    }
    this.formData.set({
      ...currentData,
      deviceProfiles: profiles,
    });
  }

  getCRFLabel(crf: number): string {
    if (crf <= 18) return 'Visually Lossless (Huge Files)';
    if (crf <= 22) return 'Excellent Quality (Large Files)';
    if (crf <= 26) return 'High Quality (Recommended)';
    if (crf <= 30) return 'Good Quality (Smaller Files)';
    if (crf <= 34) return 'Medium Quality (Web Streaming)';
    return 'Low Quality (Not Recommended)';
  }

  /**
   * Validate form and return errors object (pure - no side effects)
   */
  private getFormErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    const data = this.formData();

    if (!data.name || data.name.trim().length === 0) {
      errors.name = 'Name is required';
    } else if (data.name.length > 50) {
      errors.name = 'Name must be 50 characters or less';
    }

    if (data.targetQuality < 0 || data.targetQuality > 51) {
      errors.targetQuality = 'Quality must be between 0 and 51';
    }

    if (data.deviceProfiles.size === 0) {
      errors.deviceProfiles = 'At least one device profile must be selected';
    }

    return errors;
  }

  /**
   * Validate form and update formErrors signal
   */
  validateForm(): boolean {
    const errors = this.getFormErrors();
    this.formErrors.set(errors);
    return Object.keys(errors).length === 0;
  }

  /**
   * Check if form is valid without side effects (safe to call from template)
   */
  isFormValid(): boolean {
    const errors = this.getFormErrors();
    return Object.keys(errors).length === 0;
  }

  submitForm(): void {
    if (!this.validateForm()) {
      return;
    }

    const data = this.formData();
    const request: CreatePolicyRequest = {
      name: data.name.trim(),
      preset: data.preset,
      targetCodec: data.targetCodec,
      targetQuality: data.targetQuality,
      libraryId: data.libraryId || undefined,
      deviceProfiles: {
        appleTV: data.deviceProfiles.has(DeviceProfile.APPLE_TV),
        chromecast: data.deviceProfiles.has(DeviceProfile.CHROMECAST),
        roku: data.deviceProfiles.has(DeviceProfile.ROKU),
        web: data.deviceProfiles.has(DeviceProfile.WEB),
      },
      advancedSettings: {
        ffmpegFlags: data.ffmpegFlags || undefined,
        audioHandling: data.audioHandling,
        hardwareAcceleration: data.hardwareAcceleration,
      },
    };

    if (this.isEditMode()) {
      const policyId = this.editingPolicyId();
      if (!policyId) return;

      this.store.dispatch(PoliciesActions.updatePolicy({ id: policyId, request }));
    } else {
      this.store.dispatch(PoliciesActions.createPolicy({ request }));
    }

    this.closeForm();
  }

  confirmDelete(policy: PolicyBo): void {
    const dialogData: ConfirmationDialogData = {
      title: 'Delete Policy?',
      itemName: policy.name,
      itemType: 'policy',
      willHappen: [
        'Remove the policy from BitBonsai',
        'Stop using this policy for future encoding jobs',
        'Delete the policy configuration and settings',
      ],
      wontHappen: [
        'Delete any already-encoded videos',
        'Cancel currently running encoding jobs',
        'Affect your media files in any way',
        'Delete other policies or their settings',
      ],
      irreversible: true,
      confirmButtonText: 'Delete Policy',
      cancelButtonText: 'Keep Policy',
    };

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    dialogRef.closed.subscribe((result) => {
      if (result === true) {
        this.store.dispatch(PoliciesActions.deletePolicy({ id: policy.id }));
      }
    });
  }

  getDeviceIcon(_profile: DeviceProfile) {
    return this.icons.tv;
  }

  getDeviceLabel(profile: DeviceProfile): string {
    return profile.replace('_', ' ');
  }

  getDeviceProfileExplanation(profile: DeviceProfile): string {
    switch (profile) {
      case DeviceProfile.APPLE_TV:
        return "Optimizes encoding for Apple TV devices. Ensures compatibility with Apple's hardware decoders and supports features like HDR when available.";
      case DeviceProfile.ROKU:
        return 'Ensures compatibility with Roku streaming devices. Uses codec settings that work across the Roku device family.';
      case DeviceProfile.WEB:
        return 'Optimizes for web browser playback and media servers. Ensures compatibility with Jellyfin, Plex, Emby, and modern browsers (Chrome, Firefox, Safari, Edge).';
      case DeviceProfile.CHROMECAST:
        return 'Optimizes for Google Chromecast devices. Ensures smooth streaming and playback on all Chromecast generations.';
      default:
        return 'Device-specific optimization for playback compatibility.';
    }
  }

  getPresetIcon(preset: PolicyPreset): string {
    switch (preset) {
      case PolicyPreset.BALANCED_HEVC:
        return '⚖️';
      case PolicyPreset.FAST_HEVC:
        return '⚡';
      case PolicyPreset.QUALITY_AV1:
        return '💎';
      case PolicyPreset.COPY_IF_COMPLIANT:
        return '✅';
      case PolicyPreset.CUSTOM:
        return '🔧';
      default:
        return '📋';
    }
  }

  private getEmptyFormData(): PolicyFormData {
    return {
      name: '',
      preset: PolicyPreset.CUSTOM,
      targetCodec: TargetCodec.HEVC,
      targetQuality: 23,
      libraryId: '',
      deviceProfiles: new Set(),
      ffmpegFlags: '',
      audioHandling: AudioHandling.COPY,
      hardwareAcceleration: HardwareAcceleration.CPU,
    };
  }

  getHardwareAccelerationLabel(hw: HardwareAcceleration): string {
    switch (hw) {
      case HardwareAcceleration.NVIDIA:
        return 'NVIDIA NVENC';
      case HardwareAcceleration.INTEL_QSV:
        return 'Intel QuickSync';
      case HardwareAcceleration.AMD:
        return 'AMD AMF';
      case HardwareAcceleration.APPLE_M:
        return 'Apple VideoToolbox';
      case HardwareAcceleration.CPU:
        return 'CPU Only';
      default:
        return 'CPU Only';
    }
  }

  getAvailableHardware(): HardwareAcceleration[] {
    const envInfo = this.environmentInfo();
    if (!envInfo) {
      return [HardwareAcceleration.CPU];
    }

    const available: HardwareAcceleration[] = [HardwareAcceleration.CPU];

    if (envInfo.hardwareAcceleration.nvidia) {
      available.push(HardwareAcceleration.NVIDIA);
    }
    if (envInfo.hardwareAcceleration.intelQsv) {
      available.push(HardwareAcceleration.INTEL_QSV);
    }
    if (envInfo.hardwareAcceleration.amd) {
      available.push(HardwareAcceleration.AMD);
    }
    if (envInfo.hardwareAcceleration.appleVideoToolbox) {
      available.push(HardwareAcceleration.APPLE_M);
    }

    return available;
  }

  // Helper methods for ngModel to work with signal-based formData
  updateFormField<K extends keyof PolicyFormData>(field: K, value: PolicyFormData[K]): void {
    this.formData.update((data) => ({
      ...data,
      [field]: value,
    }));
  }

  getFormField<K extends keyof PolicyFormData>(field: K): PolicyFormData[K] {
    return this.formData()[field];
  }
}
