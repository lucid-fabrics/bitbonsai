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
import { PoliciesActions } from './+state/policies.actions';
import { PoliciesSelectors } from './+state/policies.selectors';
import type { PolicyBo } from './bos/policy.bo';
import {
  AudioHandling,
  type CreatePolicyRequest,
  DeviceProfile,
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

  // NgRx State
  readonly policies$ = this.store.select(PoliciesSelectors.selectPolicies);
  readonly presets$ = this.store.select(PoliciesSelectors.selectPresets);
  readonly isLoading$ = this.store.select(PoliciesSelectors.selectIsLoading);
  readonly error$ = this.store.select(PoliciesSelectors.selectError);

  // Local Form State
  readonly showFormModal = signal(false);
  readonly isEditMode = signal(false);
  readonly editingPolicyId = signal<string | null>(null);
  readonly showAdvancedSettings = signal(false);
  readonly formData = signal<PolicyFormData>(this.getEmptyFormData());
  readonly formErrors = signal<Record<string, string>>({});

  ngOnInit(): void {
    this.store.dispatch(PoliciesActions.loadPolicies());
    this.store.dispatch(PoliciesActions.loadPresets());
  }

  selectPreset(preset: PresetInfoModel): void {
    const formData = this.formData();
    formData.preset = preset.preset;
    formData.targetCodec = preset.codec;
    formData.targetQuality = preset.crf;
    formData.name = preset.name;
    this.formData.set({ ...formData });
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
    const formData = this.formData();
    const profiles = new Set(formData.deviceProfiles);
    if (profiles.has(profile)) {
      profiles.delete(profile);
    } else {
      profiles.add(profile);
    }
    formData.deviceProfiles = profiles;
    this.formData.set({ ...formData });
  }

  getCRFLabel(crf: number): string {
    if (crf <= 20) return 'Excellent';
    if (crf <= 25) return 'Good';
    return 'Fast';
  }

  validateForm(): boolean {
    const formData = this.formData();
    const errors: Record<string, string> = {};

    if (!formData.name || formData.name.trim().length === 0) {
      errors.name = 'Name is required';
    } else if (formData.name.length > 50) {
      errors.name = 'Name must be 50 characters or less';
    }

    if (formData.targetQuality < 0 || formData.targetQuality > 51) {
      errors.targetQuality = 'Quality must be between 0 and 51';
    }

    if (formData.deviceProfiles.size === 0) {
      errors.deviceProfiles = 'At least one device profile must be selected';
    }

    this.formErrors.set(errors);
    return Object.keys(errors).length === 0;
  }

  isFormValid(): boolean {
    return this.validateForm();
  }

  submitForm(): void {
    if (!this.validateForm()) {
      return;
    }

    const formData = this.formData();
    const request: CreatePolicyRequest = {
      name: formData.name.trim(),
      preset: formData.preset,
      targetCodec: formData.targetCodec,
      targetQuality: formData.targetQuality,
      libraryId: formData.libraryId || undefined,
      deviceProfiles: {
        appleTV: formData.deviceProfiles.has(DeviceProfile.APPLE_TV),
        chromecast: formData.deviceProfiles.has(DeviceProfile.CHROMECAST),
        roku: formData.deviceProfiles.has(DeviceProfile.ROKU),
        web: formData.deviceProfiles.has(DeviceProfile.WEB),
      },
      advancedSettings: {
        ffmpegFlags: formData.ffmpegFlags || undefined,
        audioHandling: formData.audioHandling,
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
        return 'Optimizes for web browser playback. Ensures compatibility with modern browsers like Chrome, Firefox, Safari, and Edge.';
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
    };
  }
}
