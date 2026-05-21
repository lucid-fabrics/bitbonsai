import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { TranslocoModule } from '@ngneat/transloco';
import type { FileInfoBo } from '../bos/file-info.bo';

@Component({
  selector: 'app-files-dialog',
  standalone: true,
  imports: [FontAwesomeModule, TranslocoModule],
  templateUrl: './files-dialog.modal.html',
  styleUrls: ['./files-dialog.modal.scss'],
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
