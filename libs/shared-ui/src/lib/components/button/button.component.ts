import { Component, Input } from '@angular/core';

export type ButtonVariant = 'primary' | 'outline' | 'danger';

@Component({
  selector: 'bb-button',
  standalone: true,
  imports: [],
  template: `
    <button
      [type]="type"
      [disabled]="disabled"
      [class]="'bb-button bb-button--' + variant"
    >
      <ng-content></ng-content>
    </button>
  `,
  styleUrls: ['./button.component.scss'],
})
export class ButtonComponent {
  @Input() variant: ButtonVariant = 'primary';
  @Input() type: 'button' | 'submit' = 'button';
  @Input() disabled = false;
}
