import { CommonModule } from '@angular/common';
import type { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, type OnInit, signal } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faChartLine, faCheckCircle, faGauge, faSave } from '@fortawesome/pro-solid-svg-icons';
import { Chart, type ChartConfiguration, registerables } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';

// Register Chart.js components
Chart.register(...registerables);

interface SavingsTrendData {
  date: string;
  savingsGB: number;
}

interface CodecDistribution {
  codec: string;
  count: number;
  percentage: number;
}

interface NodePerformance {
  nodeName: string;
  jobsCompleted: number;
  successRate: number;
}

interface InsightsStats {
  totalJobsCompleted: number;
  totalStorageSavedGB: number;
  averageSuccessRate: number;
  averageThroughput: number;
}

type TimeRange = 7 | 30 | 90;

@Component({
  selector: 'app-insights',
  standalone: true,
  imports: [CommonModule, BaseChartDirective, FontAwesomeModule],
  templateUrl: './insights.component.html',
  styleUrls: ['./insights.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InsightsComponent implements OnInit {
  // Icons
  faChartLine = faChartLine;
  faSave = faSave;
  faCheckCircle = faCheckCircle;
  faGauge = faGauge;

  // State
  selectedTimeRange = signal<TimeRange>(30);
  loading = signal(true);

  // Stats
  stats = signal<InsightsStats>({
    totalJobsCompleted: 0,
    totalStorageSavedGB: 0,
    averageSuccessRate: 0,
    averageThroughput: 0,
  });

  // Savings Trend Chart
  savingsTrendData = signal<ChartConfiguration<'line'>['data']>({
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
  });

  savingsTrendOptions = signal<ChartConfiguration<'line'>['options']>({
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
            return `Saved: ${context.parsed.y.toFixed(2)} GB`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: '#333333',
          drawBorder: false,
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
          drawBorder: false,
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
  });

  // Codec Distribution Chart
  codecDistributionData = signal<ChartConfiguration<'doughnut'>['data']>({
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
  });

  codecDistributionOptions = signal<ChartConfiguration<'doughnut'>['options']>({
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
  });

  // Node Performance Chart
  nodePerformanceData = signal<ChartConfiguration<'bar'>['data']>({
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
  });

  nodePerformanceOptions = signal<ChartConfiguration<'bar'>['options']>({
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
            const rawData = (context.chart.data.datasets[0] as any)._rawData;
            const successRate = rawData?.[dataIndex]?.successRate || 0;
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
          drawBorder: false,
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
  });

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadAllData();
  }

  selectTimeRange(days: TimeRange): void {
    this.selectedTimeRange.set(days);
    this.loadSavingsTrend();
  }

  private loadAllData(): void {
    this.loading.set(true);

    Promise.all([
      this.loadSavingsTrend(),
      this.loadCodecDistribution(),
      this.loadNodePerformance(),
      this.loadStats(),
    ]).finally(() => {
      this.loading.set(false);
    });
  }

  private async loadSavingsTrend(): Promise<void> {
    try {
      const days = this.selectedTimeRange();
      const data = await this.http
        .get<SavingsTrendData[]>(`/api/v1/insights/savings?days=${days}`)
        .toPromise();

      if (data) {
        const currentData = this.savingsTrendData();
        currentData.labels = data.map((d) => this.formatDate(d.date));
        currentData.datasets[0].data = data.map((d) => d.savingsGB);
        this.savingsTrendData.set({ ...currentData });
      }
    } catch (error) {
      console.error('Failed to load savings trend:', error);
      // Set empty data on error
      const currentData = this.savingsTrendData();
      currentData.labels = [];
      currentData.datasets[0].data = [];
      this.savingsTrendData.set({ ...currentData });
    }
  }

  private async loadCodecDistribution(): Promise<void> {
    try {
      const data = await this.http.get<CodecDistribution[]>('/api/v1/insights/codecs').toPromise();

      if (data) {
        const currentData = this.codecDistributionData();
        currentData.labels = data.map((d) => d.codec);
        currentData.datasets[0].data = data.map((d) => d.percentage);
        this.codecDistributionData.set({ ...currentData });
      }
    } catch (error) {
      console.error('Failed to load codec distribution:', error);
      // Set empty data on error
      const currentData = this.codecDistributionData();
      currentData.labels = [];
      currentData.datasets[0].data = [];
      this.codecDistributionData.set({ ...currentData });
    }
  }

  private async loadNodePerformance(): Promise<void> {
    try {
      const data = await this.http.get<NodePerformance[]>('/api/v1/insights/nodes').toPromise();

      if (data) {
        const currentData = this.nodePerformanceData();
        currentData.labels = data.map((d) => d.nodeName);
        currentData.datasets[0].data = data.map((d) => d.jobsCompleted);

        // Color bars based on success rate
        currentData.datasets[0].backgroundColor = data.map((d) => {
          if (d.successRate >= 90) return '#4ade80'; // Green - high success
          if (d.successRate >= 70) return '#fbbf24'; // Yellow - medium success
          return '#ff6b6b'; // Red - low success
        });

        // Store raw data for tooltip
        (currentData.datasets[0] as any)._rawData = data;

        this.nodePerformanceData.set({ ...currentData });
      }
    } catch (error) {
      console.error('Failed to load node performance:', error);
      // Set empty data on error
      const currentData = this.nodePerformanceData();
      currentData.labels = [];
      currentData.datasets[0].data = [];
      currentData.datasets[0].backgroundColor = [];
      this.nodePerformanceData.set({ ...currentData });
    }
  }

  private async loadStats(): Promise<void> {
    try {
      const data = await this.http.get<InsightsStats>('/api/v1/insights/stats').toPromise();

      if (data) {
        this.stats.set(data);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
      // Keep default stats on error
    }
  }

  private formatDate(dateString: string): string {
    const date = new Date(dateString);
    const month = date.toLocaleString('default', { month: 'short' });
    const day = date.getDate();
    return `${month} ${day}`;
  }

  formatStorageSize(gb: number): string {
    if (gb >= 1000) {
      return `${(gb / 1000).toFixed(2)} TB`;
    }
    return `${gb.toFixed(2)} GB`;
  }
}
