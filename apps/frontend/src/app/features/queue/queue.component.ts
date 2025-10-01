import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-queue',
  standalone: true,
  imports: [],
  templateUrl: './queue.component.html',
  styleUrls: ['./queue.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueueComponent {}
