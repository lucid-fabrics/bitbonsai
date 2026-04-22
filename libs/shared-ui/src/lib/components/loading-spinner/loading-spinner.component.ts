import { Component, Input } from '@angular/core';

@Component({
  selector: 'lib-loading-spinner',
  standalone: true,
  imports: [],
  template: `
    <div class="spinner-container" [style.width.px]="size" [style.height.px]="size">
      <div class="spinner"></div>
    </div>
  `,
  styleUrls: ['./loading-spinner.component.scss'],
})
export class LoadingSpinnerComponent {
  @Input() size = 40;
}
