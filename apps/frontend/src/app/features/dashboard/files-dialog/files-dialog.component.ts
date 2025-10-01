import { Component, ChangeDetectionStrategy, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FileInfoBo } from '../../../core/business-objects/file-info.bo';

@Component({
  selector: 'app-files-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './files-dialog.component.html',
  styleUrls: ['./files-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
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
