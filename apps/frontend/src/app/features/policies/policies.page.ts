import { Dialog } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { ContainerBo } from './bos/container.bo';
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
  targetContainer?: string | null;
  skipReencoding?: boolean;
  allowSameCodec?: boolean;
  minSavingsPercent?: number;
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
  private readonly destroyRef = inject(DestroyRef);

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
  readonly ContainerBo = ContainerBo;

  // NgRx State
  readonly policies$ = this.store.select(PoliciesSelectors.selectPolicies);
  readonly presets$ = this.store.select(PoliciesSelectors.selectPresets);
  readonly isLoading$ = this.store.select(PoliciesSelectors.selectIsLoading);
  readonly error$ = this.store.select(PoliciesSelectors.selectError);

  // Local Form State
  showFormModal = false;
  isEditMode = false;
  editingPolicyId: string | null = null;
  showAdvancedSettings = false;
  formData: PolicyFormData = this.getEmptyFormData();
  formErrors: Record<string, string> = {};

  ngOnInit(): void {
    this.store.dispatch(PoliciesActions.loadPolicies());
    this.store.dispatch(PoliciesActions.loadPresets());
  }

  selectPreset(preset: PresetInfoModel): void {
    this.formData = {
      ...this.formData,
      preset: preset.preset,
      targetCodec: preset.codec,
      targetQuality: preset.crf,
      name: preset.name,
    };
    this.showFormModal = true;
    this.isEditMode = false;
  }

  openCreateForm(): void {
    this.formData = this.getEmptyFormData();
    this.formErrors = {};
    this.showFormModal = true;
    this.isEditMode = false;
    this.showAdvancedSettings = false;
  }

  openEditForm(policy: PolicyBo): void {
    this.formData = {
      name: policy.name,
      preset: policy.preset,
      targetCodec: policy.targetCodec,
      targetQuality: policy.targetQuality,
      targetContainer: policy.targetContainer ?? 'mkv',
      skipReencoding: policy.skipReencoding ?? true,
      allowSameCodec: policy.allowSameCodec ?? false,
      minSavingsPercent: policy.minSavingsPercent ?? 0,
      libraryId: policy.libraryId || '',
      deviceProfiles: new Set(policy.deviceProfiles),
      ffmpegFlags: policy.ffmpegFlags || '',
      audioHandling: policy.audioHandling || AudioHandling.COPY,
    };
    this.formErrors = {};
    this.editingPolicyId = policy.id;
    this.showFormModal = true;
    this.isEditMode = true;
    this.showAdvancedSettings = false;
  }

  closeForm(): void {
    this.showFormModal = false;
    this.isEditMode = false;
    this.editingPolicyId = null;
    this.showAdvancedSettings = false;
  }

  toggleDeviceProfile(profile: DeviceProfile): void {
    const profiles = new Set(this.formData.deviceProfiles);
    if (profiles.has(profile)) {
      profiles.delete(profile);
    } else {
      profiles.add(profile);
    }
    this.formData.deviceProfiles = profiles;
  }

  getCRFLabel(crf: number): string {
    if (crf <= 18) return 'Visually Lossless (Huge Files)';
    if (crf <= 22) return 'Excellent Quality (Large Files)';
    if (crf <= 26) return 'High Quality (Recommended)';
    if (crf <= 30) return 'Good Quality (Smaller Files)';
    if (crf <= 34) return 'Medium Quality (Web Streaming)';
    return 'Low Quality (Not Recommended)';
  }

  validateForm(): boolean {
    const errors: Record<string, string> = {};

    if (!this.formData.name || this.formData.name.trim().length === 0) {
      errors.name = 'Name is required';
    } else if (this.formData.name.length > 50) {
      errors.name = 'Name must be 50 characters or less';
    }

    if (this.formData.targetQuality < 0 || this.formData.targetQuality > 51) {
      errors.targetQuality = 'Quality must be between 0 and 51';
    }

    if (this.formData.deviceProfiles.size === 0) {
      errors.deviceProfiles = 'At least one device profile must be selected';
    }

    this.formErrors = errors;
    return Object.keys(errors).length === 0;
  }

  isFormValid(): boolean {
    return this.validateForm();
  }

  submitForm(): void {
    if (!this.validateForm()) {
      return;
    }

    const request: CreatePolicyRequest = {
      name: this.formData.name.trim(),
      preset: this.formData.preset,
      targetCodec: this.formData.targetCodec,
      targetQuality: this.formData.targetQuality,
      targetContainer: this.formData.targetContainer ?? 'mkv',
      skipReencoding: this.formData.skipReencoding ?? true,
      allowSameCodec: this.formData.allowSameCodec ?? false,
      minSavingsPercent: this.formData.allowSameCodec ? (this.formData.minSavingsPercent ?? 0) : 0,
      libraryId: this.formData.libraryId || undefined,
      deviceProfiles: {
        appleTV: this.formData.deviceProfiles.has(DeviceProfile.APPLE_TV),
        chromecast: this.formData.deviceProfiles.has(DeviceProfile.CHROMECAST),
        roku: this.formData.deviceProfiles.has(DeviceProfile.ROKU),
        web: this.formData.deviceProfiles.has(DeviceProfile.WEB),
      },
      advancedSettings: {
        ffmpegFlags: this.formData.ffmpegFlags || undefined,
        audioHandling: this.formData.audioHandling,
      },
    };

    if (this.isEditMode) {
      const policyId = this.editingPolicyId;
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

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
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
      targetContainer: 'mkv',
      skipReencoding: true,
      allowSameCodec: false,
      minSavingsPercent: 0,
      libraryId: '',
      deviceProfiles: new Set(),
      ffmpegFlags: '',
      audioHandling: AudioHandling.COPY,
    };
  }
}
