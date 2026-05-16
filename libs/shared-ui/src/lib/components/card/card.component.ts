import { NgIf } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'lib-card',
  standalone: true,
  imports: [NgIf],
  template: `
    <div class="bb-card">
      <div class="bb-card__header" *ngIf="title">
        <h3 class="bb-card__title">{{ title }}</h3>
      </div>
      <div class="bb-card__content">
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styleUrls: ['./card.component.scss'],
})
export class CardComponent {
  @Input() title?: string;
}
