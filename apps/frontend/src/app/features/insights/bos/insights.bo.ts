/**
 * Business object for storage savings trend data
 */
export class SavingsTrendBO {
  constructor(
    public readonly date: string,
    public readonly savingsGB: number
  ) {}

  static fromDto(dto: { date: string; savingsGB: number }): SavingsTrendBO {
    return new SavingsTrendBO(dto.date, dto.savingsGB);
  }

  formatDate(): string {
    const date = new Date(this.date + 'T00:00:00Z');
    const month = date.toLocaleString('default', { month: 'short', timeZone: 'UTC' });
    const day = date.getUTCDate();
    return `${month} ${day}`;
  }
}

/**
 * Business object for codec distribution data
 */
export class CodecDistributionBO {
  constructor(
    public readonly codec: string,
    public readonly count: number,
    public readonly percentage: number
  ) {}

  static fromDto(dto: { codec: string; count: number; percentage: number }): CodecDistributionBO {
    return new CodecDistributionBO(dto.codec, dto.count, dto.percentage);
  }
}

/**
 * Business object for node performance data
 */
export class NodePerformanceBO {
  constructor(
    public readonly nodeName: string,
    public readonly jobsCompleted: number,
    public readonly successRate: number
  ) {}

  static fromDto(dto: {
    nodeName: string;
    jobsCompleted: number;
    successRate: number;
  }): NodePerformanceBO {
    return new NodePerformanceBO(dto.nodeName, dto.jobsCompleted, dto.successRate);
  }

  get performanceStatus(): 'high' | 'medium' | 'low' {
    if (this.successRate >= 90) return 'high';
    if (this.successRate >= 70) return 'medium';
    return 'low';
  }

  get statusColor(): string {
    switch (this.performanceStatus) {
      case 'high':
        return '#4ade80'; // Green
      case 'medium':
        return '#fbbf24'; // Yellow
      case 'low':
        return '#ff6b6b'; // Red
      default:
        return '#9ca3af'; // Gray
    }
  }
}

/**
 * Business object for insights statistics
 */
export class InsightsStatsBO {
  constructor(
    public readonly totalJobsCompleted: number,
    public readonly totalStorageSavedGB: number,
    public readonly averageSuccessRate: number,
    public readonly averageThroughput: number
  ) {}

  static fromDto(dto: {
    totalJobsCompleted: number;
    totalStorageSavedGB: number;
    averageSuccessRate: number;
    averageThroughput: number;
  }): InsightsStatsBO {
    return new InsightsStatsBO(
      dto.totalJobsCompleted,
      dto.totalStorageSavedGB,
      dto.averageSuccessRate,
      dto.averageThroughput
    );
  }

  formatStorageSize(): string {
    if (this.totalStorageSavedGB >= 1000) {
      return `${(this.totalStorageSavedGB / 1000).toFixed(2)} TB`;
    }
    return `${this.totalStorageSavedGB.toFixed(2)} GB`;
  }
}
