import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Job, Policy } from '@prisma/client';
import { normalizeCodec as normalizeCodecUtil } from '../common/utils/codec.util';
import type { EncodingProgressDto } from './dto/encoding-progress.dto';
import { FfmpegEncoderService } from './ffmpeg/ffmpeg-encoder.service';
import { FfmpegProcessManager } from './ffmpeg/ffmpeg-process-manager.service';
import type { HardwareAccelConfig } from './hardware-acceleration.service';

/** FfmpegService — thin facade over FfmpegProcessManager + FfmpegEncoderService. */
@Injectable()
export class FfmpegService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FfmpegService.name);
  private readonly CODEC_CACHE_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
  private codecCacheCleanupInterval?: NodeJS.Timeout;

  /** Proxy for tests that access (service as any).activeEncodings directly */
  get activeEncodings() {
    return this.processManager.activeEncodings;
  }

  constructor(
    private readonly processManager: FfmpegProcessManager,
    private readonly encoder: FfmpegEncoderService
  ) {}

  async onModuleInit() {
    await this.processManager.processCleanup.cleanupOrphanedTempFiles();
    this.processManager.startStderrCleanupInterval();
    this.codecCacheCleanupInterval = setInterval(
      () => this.encoder.cleanupFfprobeCodecCache(),
      this.CODEC_CACHE_CLEANUP_INTERVAL_MS
    );
    this.logger.log('✅ Cache cleanup intervals started');
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('FfmpegService shutting down - killing all active FFmpeg processes');
    this.processManager.stopStderrCleanupInterval();
    if (this.codecCacheCleanupInterval) clearInterval(this.codecCacheCleanupInterval);
    await this.processManager.killAllActiveEncodings();
    this.processManager.clearAllCaches();
    this.encoder.clearFfprobeCache();
    this.encoder.clearAllProgressTrackers();
    this.logger.log('✅ All caches cleared');
  }

  // ─── Encoding-related delegations → FfmpegEncoderService ──────────────────

  async detectHardwareAcceleration(): Promise<HardwareAccelConfig> {
    return this.encoder.detectHardwareAcceleration();
  }
  selectCodecForPolicy(targetCodec: string, hwType: string): string {
    return this.encoder.selectCodecForPolicy(targetCodec, hwType);
  }
  buildFfmpegCommand(
    job: Job,
    policy: Policy,
    hwaccel: HardwareAccelConfig,
    outputPath: string,
    resumeFromTimestamp?: string,
    _passNumber?: 1 | 2
  ): string[] {
    return this.encoder.buildFfmpegCommand(job, policy, hwaccel, outputPath, resumeFromTimestamp);
  }
  parseProgress(line: string): Pick<EncodingProgressDto, 'frame' | 'fps' | 'currentTime'> | null {
    return this.encoder.parseProgress(line);
  }
  formatSecondsToTimestamp(totalSeconds: number): string {
    return this.encoder.formatSecondsToTimestamp(totalSeconds);
  }
  async getVideoDuration(filePath: string): Promise<number> {
    return this.encoder.getVideoDuration(filePath);
  }
  async getVideoInfo(filePath: string): Promise<{ codec: string; container: string }> {
    return this.encoder.getVideoInfo(filePath);
  }
  async getVideoInfoCached(filePath: string): Promise<{ codec: string; container: string }> {
    return this.encoder.getVideoInfoCached(filePath);
  }
  normalizeCodec(codec: string): string {
    return normalizeCodecUtil(codec);
  }
  validateFilePath(filePath: string, libraryPath: string): void {
    this.encoder.validateFilePath(filePath, libraryPath);
  }
  async verifyFile(filePath: string): Promise<{ isValid: boolean; error?: string }> {
    return this.encoder.verifyFile(filePath);
  }
  async encodeFile(job: Job, policy: Policy, customOutputPath?: string): Promise<void> {
    return this.encoder.encodeFile(job, policy, customOutputPath);
  }
  async encodeSegment(
    job: Job,
    policy: Policy,
    outputPath: string,
    startSeconds: number,
    durationSeconds: number,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    return this.encoder.encodeSegment(
      job,
      policy,
      outputPath,
      startSeconds,
      durationSeconds,
      onProgress
    );
  }
  async encode(
    jobId: string,
    options: {
      inputPath: string;
      outputPath: string;
      targetCodec: string;
      targetQuality: number;
      hwAccel?: string;
      advancedSettings?: Record<string, unknown>;
      startedFromSeconds?: number;
    }
  ): Promise<void> {
    return this.encoder.encode(jobId, options);
  }

  // ─── Process lifecycle delegations → FfmpegProcessManager ─────────────────

  async reniceProcess(jobId: string, priority: number): Promise<boolean> {
    return this.processManager.reniceProcess(jobId, priority);
  }
  async killProcess(jobId: string, markProcessed = true): Promise<boolean> {
    return this.processManager.killProcess(jobId, markProcessed);
  }
  hasActiveProcess(jobId: string): boolean {
    return this.processManager.hasActiveProcess(jobId);
  }
  getActiveEncodingsDetails(): Array<{
    jobId: string;
    pid: number | undefined;
    startTime: Date;
    lastProgress: number;
    lastOutputTime: Date;
    runtimeSeconds: number;
  }> {
    return this.processManager.getActiveEncodingsDetails();
  }
  async findSystemFfmpegProcesses(): Promise<
    Array<{
      pid: number;
      command: string;
      cpuPercent: number;
      memPercent: number;
      runtimeSeconds: number;
    }>
  > {
    return this.processManager.findSystemFfmpegProcesses();
  }
  async detectZombieFfmpegProcesses(): Promise<
    Array<{
      pid: number;
      command: string;
      cpuPercent: number;
      memPercent: number;
      runtimeSeconds: number;
      isZombie: boolean;
      trackedJobId: string | null;
    }>
  > {
    return this.processManager.detectZombieFfmpegProcesses();
  }
  async killFfmpegByPid(pid: number): Promise<{ success: boolean; message: string }> {
    return this.processManager.killFfmpegByPid(pid);
  }
  async killAllZombieFfmpegProcesses(): Promise<{
    killed: number;
    failed: number;
    details: Array<{ pid: number; success: boolean; message: string }>;
  }> {
    return this.processManager.killAllZombieFfmpegProcesses();
  }
  async killAllFfmpegProcesses(): Promise<{
    killed: number;
    failed: number;
    details: Array<{ pid: number; success: boolean; message: string }>;
  }> {
    return this.processManager.killAllFfmpegProcesses();
  }
  getLastOutputTime(jobId: string): Date | undefined {
    return this.processManager.getLastOutputTime(jobId);
  }
  isProcessTrulyStuck(jobId: string, timeoutMinutes: number): boolean {
    return this.processManager.isProcessTrulyStuck(jobId, timeoutMinutes);
  }
  async cancelEncoding(jobId: string): Promise<boolean> {
    return this.processManager.cancelEncoding(jobId);
  }
  async pauseEncoding(jobId: string): Promise<boolean> {
    return this.processManager.pauseEncoding(jobId);
  }
  async resumeEncoding(jobId: string): Promise<boolean> {
    return this.processManager.resumeEncoding(jobId);
  }
  getLastStderr(jobId: string): string | null {
    return this.processManager.getLastStderr(jobId);
  }
  getActiveEncodings(): string[] {
    return this.processManager.getActiveEncodings();
  }
  getEncodingStatus(
    jobId: string
  ): { jobId: string; startTime: Date; elapsedSeconds: number } | null {
    return this.processManager.getEncodingStatus(jobId);
  }
}
