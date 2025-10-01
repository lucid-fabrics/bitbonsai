import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import type { FileInfoBo } from '../../../core/business-objects/file-info.bo';

@Component({
  selector: 'app-files-dialog',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule],
  templateUrl: './files-dialog.component.html',
  styleUrls: ['./files-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilesDialogComponent {
  @Input() folderName = '';
  @Input() codec = '';
  @Input() files: FileInfoBo[] = [];
  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();

  onClose(): void {
    this.close.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }
}
