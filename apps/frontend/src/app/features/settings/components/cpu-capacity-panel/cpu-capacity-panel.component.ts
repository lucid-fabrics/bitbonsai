import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, signal } from '@angular/core';
import { environment } from '../../../../../environments/environment';

interface SystemResources {
  cpu: {
    model: string;
    cores: number;
    coresPerJob: number;
    theoreticalMaxWorkers: number;
    safetyMargin: number;
    configuredWorkers: number;
    minWorkers: number;
    maxWorkers: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
  };
  scenarios: Array<{
    margin: number;
    label: string;
    workers: number;
    risk: string;
    description: string;
  }>;
  recommendation: {
    current: string;
    reason: string;
  };
}

@Component({
  selector: 'app-cpu-capacity-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cpu-capacity-panel.component.html',
  styleUrls: ['./cpu-capacity-panel.component.scss'],
})
export class CpuCapacityPanelComponent implements OnInit {
  resources?: SystemResources;
  loading = signal(true);
  showDetails = false;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadSystemResources();
  }

  loadSystemResources() {
    this.http.get<SystemResources>(`${environment.apiUrl}/system/resources`).subscribe({
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
    return (bytes / 1024 ** 3).toFixed(1) + ' GB';
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
