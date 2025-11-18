import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';

export interface ScheduleConflictDialogData {
  nodeName: string;
  message: string;
}

@Component({
  selector: 'app-schedule-conflict-dialog',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule],
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
