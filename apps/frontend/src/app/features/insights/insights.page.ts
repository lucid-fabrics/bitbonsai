import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, type OnInit } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faChartLine, faCheckCircle, faGauge, faSave } from '@fortawesome/pro-solid-svg-icons';
import { TranslocoModule } from '@ngneat/transloco';
import { Chart, type ChartConfiguration, registerables } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { lastValueFrom } from 'rxjs';
import { InsightsStatsBO } from './bos/insights-stats.bo';
import type { NodePerformanceBO } from './bos/node-performance.bo';
import { InsightsService } from './services/insights.service';

// Register Chart.js components
Chart.register(...registerables);

type TimeRange = 7 | 30 | 90;

// Custom dataset type with raw data for tooltips
interface NodePerformanceDataset {
  label: string;
  data: number[];
  backgroundColor: string[];
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  _rawData?: NodePerformanceBO[];
}

@Component({
  selector: 'app-insights',
  standalone: true,
  imports: [DecimalPipe, BaseChartDirective, FontAwesomeModule, TranslocoModule],
  templateUrl: './insights.page.html',
  styleUrls: ['./insights.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InsightsComponent implements OnInit {
  // Icons
  faChartLine = faChartLine;
  faSave = faSave;
  faCheckCircle = faCheckCircle;
  faGauge = faGauge;

  // State
  selectedTimeRange: TimeRange = 30;
  loading = true;

  // Stats
  stats: InsightsStatsBO = new InsightsStatsBO(0, 0, 0, 0);

  // Savings Trend Chart
  savingsTrendData: ChartConfiguration<'line'>['data'] = {
    labels: [],
    datasets: [
      {
        label: 'Storage Savings (GB)',
        data: [],
        borderColor: '#f9be03',
        backgroundColor: 'rgba(249, 190, 3, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#f9be03',
        pointBorderColor: '#1a1a1a',
        pointBorderWidth: 2,
      },
    ],
  };

  savingsTrendOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: '#1a1a1a',
        titleColor: '#f9be03',
        bodyColor: '#e0e0e0',
        borderColor: '#2d2d2d',
        borderWidth: 1,
        padding: 12,
        displayColors: false,
        callbacks: {
          label: (context) => {
            const yValue = context.parsed.y;
            return yValue !== null ? `Saved: ${yValue.toFixed(2)} GB` : 'Saved: 0.00 GB';
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: '#333333',
        },
        ticks: {
          color: '#888',
          font: {
            size: 11,
          },
        },
      },
      y: {
        grid: {
          color: '#333333',
        },
        ticks: {
          color: '#888',
          font: {
            size: 11,
          },
          callback: (value) => `${value} GB`,
        },
        beginAtZero: true,
      },
    },
  };

  // Codec Distribution Chart
  codecDistributionData: ChartConfiguration<'doughnut'>['data'] = {
    labels: [],
    datasets: [
      {
        data: [],
        backgroundColor: [
          '#f9be03', // H.264
          '#4ade80', // HEVC
          '#60a5fa', // AV1
          '#c084fc', // VP9
          '#f87171', // Others
        ],
        borderColor: '#1a1a1a',
        borderWidth: 2,
        hoverOffset: 8,
      },
    ],
  };

  codecDistributionOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: '#e0e0e0',
          padding: 16,
          font: {
            size: 12,
          },
          usePointStyle: true,
        },
      },
      tooltip: {
        backgroundColor: '#1a1a1a',
        titleColor: '#f9be03',
        bodyColor: '#e0e0e0',
        borderColor: '#2d2d2d',
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: (context) => {
            const label = context.label || '';
            const value = context.parsed;
            return `${label}: ${value.toFixed(1)}%`;
          },
        },
      },
    },
  };

  // Node Performance Chart
  nodePerformanceData: {
    labels: string[];
    datasets: NodePerformanceDataset[];
  } = {
    labels: [],
    datasets: [
      {
        label: 'Jobs Completed',
        data: [],
        backgroundColor: [],
        borderColor: '#1a1a1a',
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };

  nodePerformanceOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: '#1a1a1a',
        titleColor: '#f9be03',
        bodyColor: '#e0e0e0',
        borderColor: '#2d2d2d',
        borderWidth: 1,
        padding: 12,
        displayColors: false,
        callbacks: {
          label: (context) => {
            const dataIndex = context.dataIndex;
            const dataset = context.chart.data.datasets[0] as NodePerformanceDataset;
            const successRate = dataset._rawData?.[dataIndex]?.successRate || 0;
            return [`Jobs: ${context.parsed.y}`, `Success Rate: ${successRate.toFixed(1)}%`];
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: '#888',
          font: {
            size: 11,
          },
        },
      },
      y: {
        grid: {
          color: '#333333',
        },
        ticks: {
          color: '#888',
          font: {
            size: 11,
          },
          precision: 0,
        },
        beginAtZero: true,
      },
    },
  };

  constructor(
    private readonly insightsService: InsightsService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadAllData();
  }

  selectTimeRange(days: TimeRange): void {
    this.selectedTimeRange = days;
    this.loadSavingsTrend();
  }

  private loadAllData(): void {
    this.loading = true;
    this.cdr.markForCheck();

    Promise.all([
      this.loadSavingsTrend(),
      this.loadCodecDistribution(),
      this.loadNodePerformance(),
      this.loadStats(),
    ]).finally(() => {
      this.loading = false;
      this.cdr.markForCheck();
    });
  }

  private async loadSavingsTrend(): Promise<void> {
    try {
      const days = this.selectedTimeRange;
      const data = await lastValueFrom(this.insightsService.getSavingsTrend(days));

      if (data) {
        const currentData = this.savingsTrendData;
        currentData.labels = data.map((d) => d.formatDate());
        currentData.datasets[0].data = data.map((d) => d.savingsGB);
        this.savingsTrendData = { ...currentData };
        this.cdr.markForCheck();
      }
    } catch {
      // Set empty data on error
      const currentData = this.savingsTrendData;
      currentData.labels = [];
      currentData.datasets[0].data = [];
      this.savingsTrendData = { ...currentData };
      this.cdr.markForCheck();
    }
  }

  private async loadCodecDistribution(): Promise<void> {
    try {
      const data = await lastValueFrom(this.insightsService.getCodecDistribution());

      if (data) {
        const currentData = this.codecDistributionData;
        currentData.labels = data.map((d) => d.codec);
        currentData.datasets[0].data = data.map((d) => d.percentage);
        this.codecDistributionData = { ...currentData };
        this.cdr.markForCheck();
      }
    } catch {
      // Set empty data on error
      const currentData = this.codecDistributionData;
      currentData.labels = [];
      currentData.datasets[0].data = [];
      this.codecDistributionData = { ...currentData };
      this.cdr.markForCheck();
    }
  }

  private async loadNodePerformance(): Promise<void> {
    try {
      const data = await lastValueFrom(this.insightsService.getNodePerformance());

      if (data) {
        const currentData = this.nodePerformanceData;
        currentData.labels = data.map((d) => d.nodeName);
        currentData.datasets[0].data = data.map((d) => d.jobsCompleted);

        // Color bars based on success rate using BO logic
        currentData.datasets[0].backgroundColor = data.map((d) => d.statusColor);

        // Store raw data for tooltip
        currentData.datasets[0]._rawData = data;

        this.nodePerformanceData = { ...currentData };
        this.cdr.markForCheck();
      }
    } catch {
      // Set empty data on error
      const currentData = this.nodePerformanceData;
      currentData.labels = [];
      currentData.datasets[0].data = [];
      currentData.datasets[0].backgroundColor = [];
      this.nodePerformanceData = { ...currentData };
      this.cdr.markForCheck();
    }
  }

  private async loadStats(): Promise<void> {
    try {
      const data = await lastValueFrom(this.insightsService.getStats());

      if (data) {
        this.stats = data;
        this.cdr.markForCheck();
      }
    } catch {
      // Keep default stats on error
      this.cdr.markForCheck();
    }
  }

  formatStorageSize(gb: number): string {
    // Handle undefined, null, or NaN values
    if (gb === null || gb === undefined || Number.isNaN(gb)) {
      return '0.00 GB';
    }

    if (gb >= 1000) {
      return `${(gb / 1000).toFixed(2)} TB`;
    }
    return `${gb.toFixed(2)} GB`;
  }
}
