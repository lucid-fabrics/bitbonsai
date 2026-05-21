import { Component, Input } from '@angular/core';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info';

@Component({
  selector: 'lib-badge',
  standalone: true,
  imports: [],
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
