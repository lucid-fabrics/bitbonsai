/**
 * Shared Mock Factories for Backend Tests
 *
 * Provides complete mock objects that satisfy Prisma's strict type requirements.
 * Use these factories instead of partial objects to prevent TS2740/TS2739 errors
 * when Prisma schema changes add new fields.
 *
 * Usage:
 *   import { createMockJob, createMockPolicy, createMockNode } from '../../../testing/mock-factories';
 *   const job = createMockJob({ stage: JobStage.ENCODING, progress: 50 });
 */
import type { Job, Library, License, Metric, Node, Policy } from '@prisma/client';
import {
  AccelerationType,
  FileHealthStatus,
  JobStage,
  JobType,
  LicenseStatus,
  LicenseTier,
  MediaType,
  NetworkLocation,
  NodeRole,
  NodeStatus,
  PolicyPreset,
  SyncStatus,
  TargetCodec,
} from '@prisma/client';

/**
 * Create a complete mock Job with all required fields.
 * Override any field via the `overrides` parameter.
 */
export function createMockJob(overrides: Partial<Job> = {}): Job {
  const now = new Date();
  return {
    id: 'job-1',
    type: JobType.ENCODE,
    filePath: '/mnt/user/media/Movies/Test.mkv',
    fileLabel: 'Test Movie (2024).mkv',
    sourceCodec: 'H.264',
    sourceContainer: 'mkv',
    targetCodec: 'HEVC',
    targetContainer: 'mkv',
    stage: JobStage.QUEUED,
    lastStageChangeAt: now,
    progress: 0,
    etaSeconds: null,
    fps: null,
    beforeSizeBytes: BigInt(1000000000),
    afterSizeBytes: null,
    savedBytes: null,
    savedPercent: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    error: null,
    isBlacklisted: false,
    retryCount: 0,
    nextRetryAt: null,
    autoHealedAt: null,
    autoHealedProgress: null,
    healthStatus: FileHealthStatus.UNKNOWN,
    healthScore: 0,
    healthMessage: null,
    healthCheckedAt: null,
    healthCheckStartedAt: null,
    healthCheckRetries: 0,
    decisionRequired: false,
    decisionIssues: null,
    decisionMadeAt: null,
    decisionData: null,
    priority: 0,
    prioritySetAt: null,
    pauseRequestedAt: null,
    pauseProcessedAt: null,
    cancelRequestedAt: null,
    cancelProcessedAt: null,
    tempFilePath: null,
    resumeTimestamp: null,
    lastProgressUpdate: null,
    lastHeartbeat: null,
    heartbeatNodeId: null,
    previewImagePaths: null,
    keepOriginalRequested: false,
    originalBackupPath: null,
    originalSizeBytes: null,
    replacementAction: null,
    warning: null,
    resourceThrottled: false,
    resourceThrottleReason: null,
    ffmpegThreads: null,
    startedFromSeconds: null,
    healingPointSeconds: null,
    autoHealClaimedAt: null,
    autoHealClaimedBy: null,
    originalNodeId: null,
    manualAssignment: false,
    transferRequired: false,
    originalFilePath: null,
    transferProgress: 0,
    transferSpeedMBps: null,
    transferStartedAt: null,
    transferCompletedAt: null,
    transferLastProgressAt: null,
    transferError: null,
    remoteTempPath: null,
    transferRetryCount: 0,
    assignedAt: null,
    stickyUntil: null,
    migrationCount: 0,
    estimatedDuration: null,
    estimatedStartAt: null,
    estimatedCompleteAt: null,
    lastScoreBreakdown: null,
    assignmentReason: null,
    corruptedRequeueCount: 0,
    stuckRecoveryCount: 0,
    contentFingerprint: null,
    qualityMetrics: null,
    nodeId: 'node-1',
    libraryId: 'lib-1',
    policyId: 'policy-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a complete mock Policy with all required fields.
 */
export function createMockPolicy(overrides: Partial<Policy> = {}): Policy {
  const now = new Date();
  return {
    id: 'policy-1',
    name: 'Balanced HEVC',
    preset: PolicyPreset.BALANCED_HEVC,
    targetCodec: TargetCodec.HEVC,
    targetQuality: 23,
    targetContainer: 'mkv',
    skipReencoding: true,
    allowSameCodec: false,
    minSavingsPercent: 0,
    deviceProfiles: {},
    advancedSettings: {},
    atomicReplace: true,
    verifyOutput: true,
    skipSeeding: true,
    libraryId: 'lib-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a complete mock Node with all required fields.
 */
export function createMockNode(overrides: Partial<Node> = {}): Node {
  const now = new Date();
  return {
    id: 'node-1',
    name: 'Main Encoding Server',
    role: NodeRole.MAIN,
    status: NodeStatus.ONLINE,
    version: '1.0.0',
    acceleration: AccelerationType.CPU,
    pairingToken: null,
    pairingExpiresAt: null,
    mainNodeUrl: null,
    apiKey: 'bb_test_api_key_0123456789abcdef',
    lastHeartbeat: now,
    uptimeSeconds: 0,
    maxWorkers: 4,
    cpuLimit: 80,
    lastSyncedAt: null,
    syncStatus: SyncStatus.PENDING,
    syncRetryCount: 0,
    syncError: null,
    networkLocation: NetworkLocation.LOCAL,
    hasSharedStorage: false,
    storageBasePath: null,
    ipAddress: '192.168.1.100',
    publicUrl: null,
    vpnIpAddress: null,
    maxTransferSizeMB: 50000,
    cpuCores: null,
    ramGB: null,
    bandwidthMbps: null,
    latencyMs: null,
    lastSpeedTest: null,
    hasGpu: false,
    avgEncodingSpeed: null,
    containerType: null,
    isPrivileged: false,
    canMountNFS: true,
    environmentDetectedAt: null,
    encodingTempPath: null,
    scheduleEnabled: false,
    scheduleWindows: null,
    loadThresholdMultiplier: 3.0,
    currentSystemLoad: null,
    currentMemoryFreeGB: null,
    lastHeartbeatLoad: null,
    estimatedFreeAt: null,
    queuedJobCount: 0,
    recentFailureCount: 0,
    lastFailureAt: null,
    failureRate24h: null,
    licenseId: 'license-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a complete mock Library with all required fields.
 */
export function createMockLibrary(overrides: Partial<Library> = {}): Library {
  const now = new Date();
  return {
    id: 'lib-1',
    name: 'Movie Collection',
    path: '/mnt/user/media/Movies',
    mediaType: MediaType.MOVIE,
    enabled: true,
    watchEnabled: false,
    lastScanAt: null,
    totalFiles: 0,
    totalSizeBytes: BigInt(0),
    nodeId: 'node-1',
    defaultPolicyId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a complete mock License with all required fields.
 */
export function createMockLicense(overrides: Partial<License> = {}): License {
  const now = new Date();
  return {
    id: 'license-1',
    key: 'test-license-key',
    tier: LicenseTier.FREE,
    status: LicenseStatus.ACTIVE,
    email: 'test@example.com',
    maxNodes: 1,
    maxConcurrentJobs: 4,
    features: { multiNode: false },
    validUntil: null,
    patreonId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a complete mock Metric with all required fields.
 */
export function createMockMetric(overrides: Partial<Metric> = {}): Metric {
  const now = new Date();
  return {
    id: 'metric-1',
    date: now,
    nodeId: null,
    licenseId: null,
    jobsCompleted: 0,
    jobsFailed: 0,
    totalSavedBytes: BigInt(0),
    avgThroughputFilesPerHour: 0,
    codecDistribution: {},
    createdAt: now,
    ...overrides,
  };
}
