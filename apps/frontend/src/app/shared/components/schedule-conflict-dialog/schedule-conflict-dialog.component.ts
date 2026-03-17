import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { TranslocoModule } from '@ngneat/transloco';

export interface ScheduleConflictDialogData {
  nodeName: string;
  message: string;
}

@Component({
  selector: 'app-schedule-conflict-dialog',
  standalone: true,
  imports: [FontAwesomeModule, TranslocoModule],
  templateUrl: './schedule-conflict-dialog.component.html',
  styleUrls: ['./schedule-conflict-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScheduleConflictDialogComponent {
  readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
  readonly data = inject<ScheduleConflictDialogData>(DIALOG_DATA);

  onConfirm(): void {
    this.dialogRef.close(true);
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onCancel();
    }
  }
}
