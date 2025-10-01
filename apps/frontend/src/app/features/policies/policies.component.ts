import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faApple, faChrome, faGoogle } from '@fortawesome/free-brands-svg-icons';
import {
  faCheck,
  faEdit,
  faPlus,
  faStar,
  faTimes,
  faTrash,
  faTv,
} from '@fortawesome/free-solid-svg-icons';
import { PolicyClient } from '../../core/clients/policy.client';
import {
  AudioHandling,
  DeviceProfile,
  type PolicyModel,
  PolicyPreset,
  type PresetInfoModel,
  TargetCodec,
} from '../../core/models/policy.model';

interface PolicyFormData {
  name: string;
  preset: PolicyPreset;
  target_codec: TargetCodec;
  crf: number;
  library_id: string;
  device_profiles: Set<DeviceProfile>;
  ffmpeg_flags: string;
  audio_handling: AudioHandling;
}

@Component({
  selector: 'app-policies',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule, FormsModule],
  templateUrl: './policies.component.html',
  styleUrls: ['./policies.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoliciesComponent implements OnInit {
  private readonly policyClient = inject(PolicyClient);

  // Icons
  readonly icons = {
    star: faStar,
    plus: faPlus,
    edit: faEdit,
    trash: faTrash,
    times: faTimes,
    check: faCheck,
    tv: faTv,
    apple: faApple,
    chrome: faChrome,
    google: faGoogle,
  };

  // Enums for template
  readonly PolicyPreset = PolicyPreset;
  readonly TargetCodec = TargetCodec;
  readonly DeviceProfile = DeviceProfile;
  readonly AudioHandling = AudioHandling;

  // State
  readonly policies = signal<PolicyModel[]>([]);
  readonly presets = signal<PresetInfoModel[]>([]);
  readonly isLoading = signal(true);
  readonly error = signal<string | null>(null);

  // Form state
  readonly showFormModal = signal(false);
  readonly isEditMode = signal(false);
  readonly editingPolicyId = signal<string | null>(null);
  readonly showAdvancedSettings = signal(false);
  readonly formData = signal<PolicyFormData>(this.getEmptyFormData());
  readonly formErrors = signal<Record<string, string>>({});

  // Delete confirmation
  readonly showDeleteConfirm = signal(false);
  readonly deletingPolicyId = signal<string | null>(null);

  ngOnInit(): void {
    this.loadData();
  }

  private loadData(): void {
    this.isLoading.set(true);
    this.policyClient.getPolicies().subscribe({
      next: (policies) => {
        this.policies.set(policies);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set('Failed to load policies');
        this.isLoading.set(false);
        console.error(err);
      },
    });

    this.policyClient.getPresets().subscribe({
      next: (presets) => {
        this.presets.set(presets);
      },
      error: (err) => {
        console.error('Failed to load presets:', err);
      },
    });
  }

  selectPreset(preset: PresetInfoModel): void {
    const formData = this.formData();
    formData.preset = preset.preset;
    formData.target_codec = preset.codec;
    formData.crf = preset.crf;
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

  openEditForm(policy: PolicyModel): void {
    this.formData.set({
      name: policy.name,
      preset: policy.preset,
      target_codec: policy.target_codec,
      crf: policy.crf,
      library_id: policy.library_id || '',
      device_profiles: new Set(policy.device_profiles),
      ffmpeg_flags: policy.ffmpeg_flags || '',
      audio_handling: policy.audio_handling || AudioHandling.COPY,
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
    const profiles = new Set(formData.device_profiles);
    if (profiles.has(profile)) {
      profiles.delete(profile);
    } else {
      profiles.add(profile);
    }
    formData.device_profiles = profiles;
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

    if (formData.crf < 0 || formData.crf > 51) {
      errors.crf = 'CRF must be between 0 and 51';
    }

    if (formData.device_profiles.size === 0) {
      errors.device_profiles = 'At least one device profile must be selected';
    }

    this.formErrors.set(errors);
    return Object.keys(errors).length === 0;
  }

  submitForm(): void {
    if (!this.validateForm()) {
      return;
    }

    const formData = this.formData();
    const request = {
      name: formData.name.trim(),
      preset: formData.preset,
      target_codec: formData.target_codec,
      crf: formData.crf,
      library_id: formData.library_id || undefined,
      device_profiles: Array.from(formData.device_profiles),
      ffmpeg_flags: formData.ffmpeg_flags || undefined,
      audio_handling: formData.audio_handling,
    };

    if (this.isEditMode()) {
      const policyId = this.editingPolicyId();
      if (!policyId) return;

      this.policyClient.updatePolicy(policyId, request).subscribe({
        next: (updated) => {
          const policies = this.policies().map((p) => (p.id === policyId ? updated : p));
          this.policies.set(policies);
          this.closeForm();
        },
        error: (err) => {
          this.error.set('Failed to update policy');
          console.error(err);
        },
      });
    } else {
      this.policyClient.createPolicy(request).subscribe({
        next: (created) => {
          this.policies.set([...this.policies(), created]);
          this.closeForm();
        },
        error: (err) => {
          this.error.set('Failed to create policy');
          console.error(err);
        },
      });
    }
  }

  confirmDelete(policyId: string): void {
    this.deletingPolicyId.set(policyId);
    this.showDeleteConfirm.set(true);
  }

  cancelDelete(): void {
    this.showDeleteConfirm.set(false);
    this.deletingPolicyId.set(null);
  }

  deletePolicy(): void {
    const policyId = this.deletingPolicyId();
    if (!policyId) return;

    this.policyClient.deletePolicy(policyId).subscribe({
      next: () => {
        const policies = this.policies().filter((p) => p.id !== policyId);
        this.policies.set(policies);
        this.cancelDelete();
      },
      error: (err) => {
        this.error.set('Failed to delete policy');
        console.error(err);
        this.cancelDelete();
      },
    });
  }

  getDeviceIcon(profile: DeviceProfile) {
    switch (profile) {
      case DeviceProfile.APPLE_TV:
        return this.icons.apple;
      case DeviceProfile.ROKU:
        return this.icons.tv;
      case DeviceProfile.WEB:
        return this.icons.chrome;
      case DeviceProfile.CHROMECAST:
        return this.icons.google;
      default:
        return this.icons.tv;
    }
  }

  getDeviceLabel(profile: DeviceProfile): string {
    return profile.replace('_', ' ');
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
      target_codec: TargetCodec.HEVC,
      crf: 23,
      library_id: '',
      device_profiles: new Set(),
      ffmpeg_flags: '',
      audio_handling: AudioHandling.COPY,
    };
  }
}
