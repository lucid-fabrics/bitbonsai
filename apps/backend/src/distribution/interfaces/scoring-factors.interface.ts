/**
 * Distribution v2 Scoring Interfaces
 *
 * Defines all types for the enhanced job distribution algorithm.
 */

/**
 * Individual scoring factors for a node-job pair
 */
export interface ScoringFactors {
  // Gate factor (binary)
  scheduleAvailable: boolean;

  // Positive factors (add to score)
  realTimeLoad: number; // 0-30 pts - based on actual CPU/memory
  queueDepth: number; // 0-20 pts - based on pending job count
  hardware: number; // 0-25 pts - GPU + CPU cores
  performance: number; // 0-25 pts - historical encoding speed
  codecMatch: number; // 0-20 pts - HW acceleration for target codec
  libraryAffinity: number; // 0-10 pts - same library bonus
  etaBalance: number; // 0-15 pts - prefer nodes finishing sooner
  fileSizeSpread: number; // 0-15 pts - spread large files

  // Negative factors (subtract from score)
  stickiness: number; // -20 to 0 pts - penalty for migration
  transferCost: number; // -25 to 0 pts - penalty if no shared storage
  reliability: number; // -15 to 0 pts - recent failure penalty
}

/**
 * Complete score result for a node
 */
export interface NodeScore {
  nodeId: string;
  nodeName: string;
  totalScore: number;
  factors: ScoringFactors;
  computedAt: Date;
}

/**
 * Score comparison for migration decisions
 */
export interface MigrationDecision {
  shouldMigrate: boolean;
  currentScore: number;
  newScore: number;
  scoreDelta: number;
  reason: string;
}

/**
 * Real-time load data from heartbeat
 */
export interface HeartbeatLoadData {
  load1m: number;
  load5m: number;
  load15m: number;
  memFreeGB: number;
  memTotalGB: number;
  cpuCount: number;
  timestamp: Date;
}

/**
 * Node capacity status
 */
export interface NodeCapacity {
  nodeId: string;
  nodeName: string;
  role: 'MAIN' | 'LINKED';
  maxWorkers: number;
  activeJobs: number;
  queuedJobs: number;
  availableSlots: number;
  estimatedFreeAt: Date | null;
  isOverloaded: boolean;
  overloadReason?: string;
  // Load metrics for UI display
  loadAvg1m?: number;
  cpuCount?: number;
  freeMemoryGB?: number;
  totalMemoryGB?: number;
}

/**
 * Job duration estimate
 */
export interface DurationEstimate {
  estimatedSeconds: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  basedOn: 'HISTORICAL' | 'FILE_SIZE' | 'DEFAULT';
  factors: {
    fileSizeGB: number;
    sourceCodec: string;
    targetCodec: string;
    resolution?: string;
  };
}

/**
 * Distribution config (from database)
 */
export interface DistributionWeights {
  weightRealTimeLoad: number;
  weightQueueDepth: number;
  weightHardware: number;
  weightPerformance: number;
  weightStickiness: number;
  weightTransferCost: number;
  weightCodecMatch: number;
  weightLibraryAffinity: number;
  weightReliability: number;
  weightETABalance: number;
  weightFileSizeSpread: number;
}

/**
 * Distribution config settings
 */
export interface DistributionSettings {
  stickinessMinutes: number;
  failureWindow24h: boolean;
  enableETABalancing: boolean;
  enableFileSizeSpread: boolean;
  enableLibraryAffinity: boolean;
  migrationScoreThreshold: number;
  maxMigrationsPerJob: number;
  highLoadThreshold: number;
  scoreCacheTtlSeconds: number;
}

/**
 * Full distribution config
 */
export interface DistributionConfigData extends DistributionWeights, DistributionSettings {
  id: string;
  isActive: boolean;
}

/**
 * Job assignment result
 */
export interface JobAssignmentResult {
  jobId: string;
  nodeId: string;
  nodeName: string;
  score: number;
  factors: ScoringFactors;
  reason: string;
  wasMigrated: boolean;
  previousNodeId?: string;
}

/**
 * Score breakdown for UI display
 */
export interface ScoreBreakdownDisplay {
  factor: string;
  label: string;
  value: number;
  maxValue: number;
  percentage: number;
  description: string;
}
