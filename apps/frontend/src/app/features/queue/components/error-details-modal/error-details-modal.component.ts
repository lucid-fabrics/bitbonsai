import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-error-details-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './error-details-modal.component.html',
  styleUrls: ['./error-details-modal.component.scss'],
})
export class ErrorDetailsModalComponent {
  @Input() isOpen = false;
  @Input() fileName = '';
  @Input() error = '';
  @Input() status = '';
  @Input() jobId = '';

  @Output() closeModal = new EventEmitter<void>();

  close() {
    this.closeModal.emit();
  }

  copyToClipboard() {
    const errorText = `Job ID: ${this.jobId}
File: ${this.fileName}
Status: ${this.status}

Error Details:
${this.error}`;

    navigator.clipboard.writeText(errorText).then(() => {
      console.log('Error details copied to clipboard');
    });
  }
}
