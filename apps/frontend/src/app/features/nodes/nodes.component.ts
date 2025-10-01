import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-nodes',
  standalone: true,
  imports: [],
  templateUrl: './nodes.component.html',
  styleUrls: ['./nodes.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodesComponent {}
