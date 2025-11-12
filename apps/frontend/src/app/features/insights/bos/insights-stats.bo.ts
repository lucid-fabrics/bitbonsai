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
    totalSavedGB: number;
    successRate: number;
    avgThroughput: number;
  }): InsightsStatsBO {
    return new InsightsStatsBO(
      dto.totalJobsCompleted,
      dto.totalSavedGB,
      dto.successRate,
      dto.avgThroughput
    );
  }

  formatStorageSize(): string {
    if (this.totalStorageSavedGB >= 1000) {
      return `${(this.totalStorageSavedGB / 1000).toFixed(2)} TB`;
    }
    return `${this.totalStorageSavedGB.toFixed(2)} GB`;
  }
}
