import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-policies',
  standalone: true,
  imports: [],
  templateUrl: './policies.component.html',
  styleUrls: ['./policies.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoliciesComponent {}
