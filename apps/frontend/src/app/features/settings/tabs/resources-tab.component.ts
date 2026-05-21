import { Component } from '@angular/core';
import { TranslocoModule } from '@ngneat/transloco';
import { CpuCapacityPanelComponent } from '../components/cpu-capacity-panel/cpu-capacity-panel.component';

@Component({
  selector: 'app-resources-tab',
  standalone: true,
  imports: [CpuCapacityPanelComponent, TranslocoModule],
  template: `
    <div class="tab-panel">
      <h2>System Resources</h2>
      <p class="tab-description">
        Monitor CPU capacity and understand how BitBonsai manages your system's
        resources
      </p>

      <app-cpu-capacity-panel></app-cpu-capacity-panel>
    </div>
  `,
})
export class ResourcesTabComponent {}
