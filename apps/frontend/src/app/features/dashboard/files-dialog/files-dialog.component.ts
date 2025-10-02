import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
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
  readonly folderName = input<string>('');
  readonly codec = input<string>('');
  readonly files = input<FileInfoBo[]>([]);
  readonly isOpen = input<boolean>(false);
  readonly close = output<void>();

  onClose(): void {
    this.close.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }
}
