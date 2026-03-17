import { NgClass, NgIf } from '@angular/common';
import { Component, Input } from '@angular/core';
import { CardComponent } from '../card/card.component';

export interface TrendData {
  value: number;
  direction: 'up' | 'down';
}

@Component({
  selector: 'bb-stat-card',
  standalone: true,
  imports: [NgIf, NgClass, CardComponent],
  template: `
    <bb-card>
      <div class="stat-card">
        <div class="stat-card__label">{{ label }}</div>
        <div class="stat-card__value">{{ formattedValue }}</div>
        <div class="stat-card__trend" *ngIf="trend">
          <span [class]="'trend trend--' + trend.direction">
            {{ trend.direction === 'up' ? '↑' : '↓' }}
            {{ trend.value }}%
          </span>
        </div>
      </div>
    </bb-card>
  `,
  styleUrls: ['./stat-card.component.scss'],
})
export class StatCardComponent {
  @Input() label = '';
  @Input() value: number | string = 0;
  @Input() format: 'number' | 'currency' | 'percentage' = 'number';
  @Input() trend?: TrendData;

  get formattedValue(): string {
    if (typeof this.value === 'string') {
      return this.value;
    }

    switch (this.format) {
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(this.value);
      case 'percentage':
        return `${this.value.toFixed(1)}%`;
      default:
        return this.value.toLocaleString();
    }
  }
}
