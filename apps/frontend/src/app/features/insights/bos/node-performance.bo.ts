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
