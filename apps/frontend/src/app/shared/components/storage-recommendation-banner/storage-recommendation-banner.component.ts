import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  ContainerType,
  StorageMethod,
  StorageRecommendation,
} from '../../../features/nodes/models/storage-recommendation.model';

@Component({
  selector: 'app-storage-recommendation-banner',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule],
  templateUrl: './storage-recommendation-banner.component.html',
  styleUrls: ['./storage-recommendation-banner.component.scss'],
})
export class StorageRecommendationBannerComponent {
  @Input() recommendation?: StorageRecommendation;
  @Input() sourceNodeName?: string;
  @Input() targetNodeName?: string;
  @Input() containerType?: string | null;
  @Output() configure = new EventEmitter<void>();
  @Output() dismiss = new EventEmitter<void>();

  StorageMethod = StorageMethod;
  ContainerType = ContainerType;

  get bannerClass(): string {
    if (!this.recommendation) return 'info';

    if (this.recommendation.warning || this.recommendation.actionRequired) {
      return 'warning';
    }

    return this.recommendation.recommended === StorageMethod.NFS ? 'success' : 'info';
  }

  get icon(): string {
    if (!this.recommendation) return 'info-circle';

    if (this.recommendation.warning) {
      return 'exclamation-triangle';
    }

    return this.recommendation.recommended === StorageMethod.NFS ? 'check-circle' : 'info-circle';
  }

  get methodBadgeClass(): string {
    if (!this.recommendation) return 'badge-info';

    switch (this.recommendation.recommended) {
      case StorageMethod.NFS:
        return 'badge-success';
      case StorageMethod.RSYNC:
        return 'badge-info';
      case StorageMethod.EITHER:
        return 'badge-secondary';
      default:
        return 'badge-info';
    }
  }

  get methodDescription(): string {
    if (!this.recommendation) return '';

    switch (this.recommendation.recommended) {
      case StorageMethod.NFS:
        return 'Direct file access via NFS mount - Instant encoding start';
      case StorageMethod.RSYNC:
        return 'File transfer via rsync - 3-5% overhead, works anywhere';
      case StorageMethod.EITHER:
        return 'Both methods supported - Choose based on preference';
      default:
        return '';
    }
  }

  onConfigure(): void {
    this.configure.emit();
  }

  onDismiss(): void {
    this.dismiss.emit();
  }
}
