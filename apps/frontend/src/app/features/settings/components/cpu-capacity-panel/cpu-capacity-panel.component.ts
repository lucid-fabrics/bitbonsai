import { NgClass } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { TranslocoModule } from '@ngneat/transloco';
import type { SystemResources } from '../../models/system-resources.model';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-cpu-capacity-panel',
  standalone: true,
  imports: [NgClass, TranslocoModule],
  templateUrl: './cpu-capacity-panel.component.html',
  styleUrls: ['./cpu-capacity-panel.component.scss'],
})
export class CpuCapacityPanelComponent implements OnInit {
  private readonly settingsService = inject(SettingsService);

  resources?: SystemResources;
  loading = signal(true);
  showDetails = false;

  ngOnInit() {
    this.loadSystemResources();
  }

  loadSystemResources() {
    this.settingsService.getSystemResources().subscribe({
      next: (data) => {
        this.resources = data;
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  toggleDetails() {
    this.showDetails = !this.showDetails;
  }

  formatBytes(bytes: number): string {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }

  getWorkerPercentage(): number {
    if (!this.resources) return 0;
    return (this.resources.cpu.configuredWorkers / this.resources.cpu.theoreticalMaxWorkers) * 100;
  }

  getRiskClass(risk: string): string {
    switch (risk) {
      case 'low':
        return 'risk-low';
      case 'medium':
        return 'risk-medium';
      case 'high':
        return 'risk-high';
      default:
        return '';
    }
  }

  isCurrentScenario(margin: number): boolean {
    return this.resources?.cpu.safetyMargin === margin;
  }
}
