import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import type { Library } from '../../../../core/models/library.model';

@Component({
  selector: 'app-library-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './library-card.component.html',
  styleUrls: ['./library-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryCardComponent {
  @Input({ required: true }) library!: Library;
  @Output() readonly edit = new EventEmitter<Library>();
  @Output() readonly scan = new EventEmitter<Library>();
  @Output() readonly delete = new EventEmitter<Library>();

  onEdit(): void {
    this.edit.emit(this.library);
  }

  onScan(): void {
    this.scan.emit(this.library);
  }

  onDelete(): void {
    this.delete.emit(this.library);
  }

  getMediaTypeIcon(mediaType: string): string {
    switch (mediaType) {
      case 'MOVIE':
        return 'fa-film';
      case 'TV_SHOW':
        return 'fa-tv';
      case 'MIXED':
        return 'fa-shuffle';
      default:
        return 'fa-folder-open';
    }
  }

  getMediaTypeLabel(mediaType: string): string {
    return mediaType.replace('_', ' ');
  }

  formatSize(sizeBytes: string): string {
    const bytes = BigInt(sizeBytes);
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0n) return '0 B';

    const i = Math.floor(Math.log(Number(bytes)) / Math.log(1024));
    const value = Number(bytes) / 1024 ** i;

    return `${value.toFixed(2)} ${sizes[i]}`;
  }

  formatDate(date: string | null): string {
    if (!date) return 'Never';

    const scanDate = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - scanDate.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return scanDate.toLocaleDateString();
  }
}
