import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-libraries',
  standalone: true,
  imports: [],
  templateUrl: './libraries.component.html',
  styleUrls: ['./libraries.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibrariesComponent {}
