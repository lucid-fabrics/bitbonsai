import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info';

@Component({
  selector: 'bb-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span [class]="'bb-badge bb-badge--' + variant">
      <ng-content></ng-content>
    </span>
  `,
  styleUrls: ['./badge.component.scss'],
})
export class BadgeComponent {
  @Input() variant: BadgeVariant = 'info';
}
