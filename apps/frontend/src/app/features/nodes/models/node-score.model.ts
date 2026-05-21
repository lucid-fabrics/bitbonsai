/**
 * Node Score Model
 *
 * Represents the weighted score breakdown for a node used in job attribution.
 */
export interface NodeScore {
  nodeId: string;
  nodeName: string;
  totalScore: number;
  breakdown: {
    scheduleAvailable: boolean;
    loadScore: number;
    hardwareScore: number;
    performanceScore: number;
  };
}
