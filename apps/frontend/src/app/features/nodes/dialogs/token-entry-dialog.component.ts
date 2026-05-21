import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoModule } from '@ngneat/transloco';

export type TokenEntryDialogData = object;

@Component({
  selector: 'app-token-entry-dialog',
  standalone: true,
  imports: [FormsModule, TranslocoModule],
  templateUrl: './token-entry-dialog.component.html',
  styleUrls: ['./token-entry-dialog.component.scss'],
})
export class TokenEntryDialogComponent {
  readonly data: TokenEntryDialogData | null = inject(DIALOG_DATA, {
    optional: true,
  });
  readonly dialogRef = inject(DialogRef);

  token = '';
  showError = false;

  /**
   * Handle token input - only allow numbers
   */
  onTokenInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/[^0-9]/g, '');
    this.token = value;
    this.showError = false;
  }

  /**
   * Submit the token
   */
  submit(): void {
    if (!this.token || this.token.length !== 6) {
      this.showError = true;
      return;
    }

    this.dialogRef.close(this.token);
  }

  /**
   * Close dialog (backdrop click or close button)
   */
  onClose(): void {
    this.dialogRef.close();
  }
}
