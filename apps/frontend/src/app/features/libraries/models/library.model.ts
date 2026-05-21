export enum MediaType {
  MOVIE = 'MOVIE',
  TV_SHOW = 'TV_SHOW',
  ANIME = 'ANIME',
  ANIME_MOVIE = 'ANIME_MOVIE',
  MIXED = 'MIXED',
  OTHER = 'OTHER',
}

export interface LibraryNode {
  id: string;
  name: string;
  status: string;
}

export interface LibraryPolicy {
  id: string;
  name: string;
  preset: string;
}

export interface LibraryJobCount {
  jobs: number;
}

export interface Library {
  id: string;
  name: string;
  path: string;
  mediaType: MediaType;
  enabled: boolean;
  watchEnabled: boolean;
  lastScanAt: string | null;
  totalFiles: number;
  totalSizeBytes: string;
  node: LibraryNode;
  defaultPolicyId: string | null;
  defaultPolicy: LibraryPolicy | null;
  policies: LibraryPolicy[];
  _count: LibraryJobCount;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLibraryDto {
  name: string;
  path: string;
  mediaType: MediaType;
}

export interface UpdateLibraryDto {
  name?: string;
  path?: string;
  mediaType?: MediaType;
  enabled?: boolean;
  watchEnabled?: boolean;
  defaultPolicyId?: string | null;
}

export enum FileHealthStatus {
  HEALTHY = 'HEALTHY',
  WARNING = 'WARNING',
  CORRUPTED = 'CORRUPTED',
  UNKNOWN = 'UNKNOWN',
}

export interface VideoFile {
  filePath: string;
  fileName: string;
  codec: string;
  resolution: string;
  duration: number;
  sizeBytes: number;
  healthStatus: FileHealthStatus;
  healthMessage?: string;
  jobId?: string;
  jobStage?: string;
  jobProgress?: number;
  canAddToQueue: boolean;
  blockedReason?: string;
}

export interface PolicyOption {
  id: string;
  name: string;
  preset: string;
}

export interface ScanPreview {
  libraryId: string;
  libraryName: string;
  policyId: string | null;
  policyName: string | null;
  targetCodec: string | null;
  availablePolicies: PolicyOption[];
  totalFiles: number;
  totalSizeBytes: string;
  needsEncodingCount: number;
  alreadyOptimizedCount: number;
  needsEncoding: VideoFile[];
  alreadyOptimized: VideoFile[];
  errors: Array<{ filePath: string; error: string }>;
  scannedAt: Date;
}

export interface CreateJobsFromScanDto {
  policyId?: string;
  filePaths?: string[];
}

export interface CreateAllJobsDto {
  policyId: string;
}

export interface BulkJobCreationResult {
  jobsCreated: number;
  filesSkipped: number;
  skippedFiles: Array<{ path: string; reason: string }>;
}

/**
 * Minimal job info returned from createJobsFromScan
 */
export interface CreatedJobSummary {
  id: string;
  filePath: string;
  fileLabel: string;
  stage: string;
}

export interface CreateJobsFromScanResult {
  jobsCreated: number;
  jobs: CreatedJobSummary[];
}

export interface LibraryFile {
  filePath: string;
  fileName: string;
  codec: string;
  resolution: string;
  sizeBytes: number;
  duration: number;
  healthStatus: FileHealthStatus;
  healthMessage?: string;
}

export interface LibraryFiles {
  libraryId: string;
  libraryName: string;
  totalFiles: number;
  totalSizeBytes: string;
  files: LibraryFile[];
  scannedAt: Date;
}
