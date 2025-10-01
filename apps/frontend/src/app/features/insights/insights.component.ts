import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-insights',
  standalone: true,
  imports: [],
  templateUrl: './insights.component.html',
  styleUrls: ['./insights.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InsightsComponent {}
