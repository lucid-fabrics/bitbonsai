import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { NodesService } from '../nodes/nodes.service';

export interface SystemLoadCheck {
  isOverloaded: boolean;
  reason: string;
  details: string;
}

export interface SystemLoadInfo {
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  cpuCount: number;
  loadThreshold: number;
  loadThresholdMultiplier: number;
  freeMemoryGB: number;
  totalMemoryGB: number;
  isOverloaded: boolean;
  reason: string;
}

/**
 * SystemResourceService
 *
 * Manages system resource monitoring, load-based throttling, and preflight checks.
 * Provides CPU-aware worker calculation and disk/memory validation.
 *
 * Extracted from EncodingProcessorService to separate resource concerns.
 */
@Injectable()
export class SystemResourceService {
  public readonly logger = new Logger(SystemResourceService.name);

  // CPU-Aware Worker Calculation Constants
  private readonly CORES_PER_HEVC_JOB = 4;
  private readonly WORKER_SAFETY_MARGIN = 0.5;
  private readonly MIN_WORKERS_PER_NODE = 2;
  private readonly MAX_WORKERS_PER_NODE = 12;

  // Resource preflight thresholds
  private readonly MIN_FREE_DISK_SPACE_GB = 5;
  private readonly MIN_FREE_MEMORY_PERCENT = 10;
  private readonly DISK_SPACE_BUFFER_PERCENT = 20;

  // Load-based throttling
  private readonly DEFAULT_LOAD_THRESHOLD_MULTIPLIER = Math.min(
    parseFloat(process.env.LOAD_THRESHOLD_MULTIPLIER || '2.0'),
    2.0
  );
  private loadThresholdMultiplier: number = this.DEFAULT_LOAD_THRESHOLD_MULTIPLIER;
  private readonly MIN_FREE_MEMORY_GB = 4;
  private readonly THROTTLE_CHECK_INTERVAL_MS = 10000;
  private readonly THROTTLE_LOG_INTERVAL_MS = 60000;
  private lastThrottleLogTime = 0;

  // Encoding temp path (SSD cache pool)
  private encodingTempPath: string | null = process.env.ENCODING_TEMP_PATH || null;

  // Calculated optimal workers
  readonly defaultWorkersPerNode: number;

  constructor(private readonly nodesService: NodesService) {
    this.defaultWorkersPerNode = this.calculateOptimalWorkers();
  }

  /**
   * Calculate optimal concurrent workers based on CPU capacity.
   *
   * Formula: workers = Math.floor((cpuCores / CORES_PER_JOB) * SAFETY_MARGIN)
   * Clamped between MIN_WORKERS_PER_NODE and MAX_WORKERS_PER_NODE.
   */
  calculateOptimalWorkers(): number {
    let cpuCount = os.cpus().length;
    if (!cpuCount || cpuCount < 1) {
      this.logger.warn(`Invalid CPU count detected: ${cpuCount}, using fallback of 8 cores`);
      cpuCount = 8;
    } else if (cpuCount < 4) {
      this.logger.warn(
        `Low CPU count detected: ${cpuCount}, using minimum of 4 cores for worker calculation`
      );
      cpuCount = 4;
    }

    const theoreticalMax = Math.floor(cpuCount / this.CORES_PER_HEVC_JOB);
    const optimalWorkers = Math.floor(theoreticalMax * this.WORKER_SAFETY_MARGIN);
    const clampedWorkers = Math.max(
      this.MIN_WORKERS_PER_NODE,
      Math.min(optimalWorkers, this.MAX_WORKERS_PER_NODE)
    );

    this.logger.log('CPU-Aware Worker Calculation:');
    this.logger.log(`  CPU Cores Detected: ${cpuCount}`);
    this.logger.log(`  Cores Per HEVC Job: ${this.CORES_PER_HEVC_JOB}`);
    this.logger.log(`  Theoretical Max Workers: ${theoreticalMax}`);
    this.logger.log(`  Safety Margin: ${this.WORKER_SAFETY_MARGIN * 100}%`);
    this.logger.log(`  Optimal Workers (after margin): ${optimalWorkers}`);
    this.logger.log(
      `  Final Workers (clamped ${this.MIN_WORKERS_PER_NODE}-${this.MAX_WORKERS_PER_NODE}): ${clampedWorkers}`
    );
    this.logger.log(`  Using ${clampedWorkers} concurrent workers per node`);

    return clampedWorkers;
  }

  /**
   * Check if system is overloaded and should throttle new jobs.
   */
  checkSystemLoad(): SystemLoadCheck {
    const cpuCount = os.cpus().length;
    const loadAvg = os.loadavg()[0];
    const loadThreshold = cpuCount * this.loadThresholdMultiplier;

    const freeMemory = os.freemem();
    const freeMemoryGB = freeMemory / 1024 ** 3;

    const details =
      `Load: ${loadAvg.toFixed(2)}/${loadThreshold.toFixed(0)} (${cpuCount} cores), ` +
      `Memory: ${freeMemoryGB.toFixed(1)}GB free`;

    if (loadAvg > loadThreshold) {
      return {
        isOverloaded: true,
        reason: `High system load (${loadAvg.toFixed(2)} > ${loadThreshold.toFixed(0)})`,
        details,
      };
    }

    if (freeMemoryGB < this.MIN_FREE_MEMORY_GB) {
      return {
        isOverloaded: true,
        reason: `Low memory (${freeMemoryGB.toFixed(1)}GB < ${this.MIN_FREE_MEMORY_GB}GB)`,
        details,
      };
    }

    return { isOverloaded: false, reason: '', details };
  }

  /**
   * Wait for system load to decrease before starting new job.
   * Logs warnings periodically to avoid log spam.
   */
  async waitForSystemLoad(): Promise<void> {
    let check = this.checkSystemLoad();

    while (check.isOverloaded) {
      const now = Date.now();

      if (now - this.lastThrottleLogTime > this.THROTTLE_LOG_INTERVAL_MS) {
        this.logger.warn(`THROTTLING: ${check.reason}`);
        this.logger.warn(`   ${check.details}`);
        this.logger.warn(`   Waiting for system to stabilize before starting new jobs...`);
        this.lastThrottleLogTime = now;
      }

      await new Promise((resolve) => setTimeout(resolve, this.THROTTLE_CHECK_INTERVAL_MS));
      check = this.checkSystemLoad();
    }
  }

  /**
   * Perform resource preflight checks before starting encoding.
   *
   * Verifies:
   * - File is readable
   * - Sufficient disk space (source file size + 20% buffer + 5GB minimum)
   * - Sufficient free memory (at least 10% RAM available)
   *
   * @throws Error if resources are insufficient
   */
  async performResourcePreflightChecks(filePath: string, jobId: string): Promise<void> {
    const checks: string[] = [];

    // Check 1: File accessibility
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      checks.push('File readable');
    } catch {
      throw new Error(
        `Cannot read source file: ${filePath}\n\n` +
          `Possible causes:\n` +
          `- File permissions deny read access\n` +
          `- File is locked by another process\n` +
          `- Network share disconnected`
      );
    }

    // Check 2: Disk space
    const fileStats = await fs.promises.stat(filePath);
    const fileSizeBytes = fileStats.size;
    const outputDir = path.dirname(filePath);

    try {
      const stats = await fs.promises.statfs(outputDir);
      const availableBytes = stats.bavail * stats.bsize;
      const availableGB = availableBytes / 1024 ** 3;
      const requiredBytes = fileSizeBytes * (1 + this.DISK_SPACE_BUFFER_PERCENT / 100);
      const requiredGB = requiredBytes / 1024 ** 3;
      const minimumRequiredBytes = Math.max(requiredBytes, this.MIN_FREE_DISK_SPACE_GB * 1024 ** 3);
      const minimumRequiredGB = minimumRequiredBytes / 1024 ** 3;

      if (availableBytes < minimumRequiredBytes) {
        throw new Error(
          `Insufficient disk space on ${outputDir}\n\n` +
            `Available: ${availableGB.toFixed(2)} GB\n` +
            `Required: ${minimumRequiredGB.toFixed(2)} GB (source file + ${this.DISK_SPACE_BUFFER_PERCENT}% buffer)\n` +
            `Minimum: ${this.MIN_FREE_DISK_SPACE_GB} GB\n\n` +
            `Please free up disk space before retrying this job.`
        );
      }

      checks.push(
        `Disk space sufficient (${availableGB.toFixed(1)}GB available, ${requiredGB.toFixed(1)}GB needed)`
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('Insufficient disk space')) {
        throw error;
      }
      this.logger.warn(`Could not check disk space for ${outputDir}: ${error}`);
      checks.push('Disk space check skipped (statfs unavailable)');
    }

    // Check 3: Memory
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const freeMemoryPercent = (freeMemory / totalMemory) * 100;
    const freeMemoryGB = freeMemory / 1024 ** 3;

    if (freeMemoryPercent < this.MIN_FREE_MEMORY_PERCENT) {
      this.logger.warn(
        `Low memory warning: ${freeMemoryGB.toFixed(2)}GB (${freeMemoryPercent.toFixed(1)}%) free. ` +
          `Job may be slower or fail if system runs out of memory.`
      );
      checks.push(
        `Low memory (${freeMemoryGB.toFixed(1)}GB / ${freeMemoryPercent.toFixed(1)}% free)`
      );
    } else {
      checks.push(
        `Memory sufficient (${freeMemoryGB.toFixed(1)}GB / ${freeMemoryPercent.toFixed(1)}% free)`
      );
    }

    this.logger.log(`Resource preflight checks for job ${jobId}:\n  ${checks.join('\n  ')}`);
  }

  /**
   * Reload load threshold and temp path from database.
   */
  async reloadLoadThreshold(): Promise<void> {
    try {
      const currentNode = await this.nodesService.getCurrentNode();
      const nodeWithSettings = currentNode as typeof currentNode & {
        loadThresholdMultiplier?: number;
        encodingTempPath?: string | null;
      };

      if (nodeWithSettings?.loadThresholdMultiplier) {
        this.loadThresholdMultiplier = nodeWithSettings.loadThresholdMultiplier;
        this.logger.log(
          `Load threshold loaded from database: ${this.loadThresholdMultiplier}x (${os.cpus().length} cores = max load ${(os.cpus().length * this.loadThresholdMultiplier).toFixed(0)})`
        );
      } else {
        this.loadThresholdMultiplier = this.DEFAULT_LOAD_THRESHOLD_MULTIPLIER;
        this.logger.log(
          `Load threshold using default: ${this.loadThresholdMultiplier}x (${os.cpus().length} cores = max load ${(os.cpus().length * this.loadThresholdMultiplier).toFixed(0)})`
        );
      }

      if (nodeWithSettings?.encodingTempPath) {
        this.encodingTempPath = nodeWithSettings.encodingTempPath;
        this.logger.log(`Encoding temp path loaded from database: ${this.encodingTempPath}`);
      } else if (process.env.ENCODING_TEMP_PATH) {
        this.encodingTempPath = process.env.ENCODING_TEMP_PATH;
        this.logger.log(`Encoding temp path from ENV: ${this.encodingTempPath}`);
      } else {
        this.encodingTempPath = null;
        this.logger.debug('No encoding temp path configured, using source directory');
      }
    } catch (error: unknown) {
      this.loadThresholdMultiplier = this.DEFAULT_LOAD_THRESHOLD_MULTIPLIER;
      this.encodingTempPath = process.env.ENCODING_TEMP_PATH || null;
      this.logger.warn(`Failed to load settings from database, using defaults`, error);
    }
  }

  getLoadThresholdMultiplier(): number {
    return this.loadThresholdMultiplier;
  }

  getEncodingTempPath(): string | null {
    return this.encodingTempPath;
  }

  getSystemLoadInfo(): SystemLoadInfo {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    const loadThreshold = cpuCount * this.loadThresholdMultiplier;
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const check = this.checkSystemLoad();

    return {
      loadAvg1m: loadAvg[0],
      loadAvg5m: loadAvg[1],
      loadAvg15m: loadAvg[2],
      cpuCount,
      loadThreshold,
      loadThresholdMultiplier: this.loadThresholdMultiplier,
      freeMemoryGB: freeMemory / 1024 ** 3,
      totalMemoryGB: totalMemory / 1024 ** 3,
      isOverloaded: check.isOverloaded,
      reason: check.reason,
    };
  }

  get maxWorkersPerNode(): number {
    return this.MAX_WORKERS_PER_NODE;
  }
}
