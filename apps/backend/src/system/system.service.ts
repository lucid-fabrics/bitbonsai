import { Injectable } from '@nestjs/common';
import * as os from 'os';

@Injectable()
export class SystemService {
  // Same constants as encoding processor
  private readonly CORES_PER_HEVC_JOB = 4;
  private readonly WORKER_SAFETY_MARGIN = 0.5;
  private readonly MIN_WORKERS_PER_NODE = 2;
  private readonly MAX_WORKERS_PER_NODE = 12;

  getSystemResources() {
    const cpuCount = os.cpus().length;
    const theoreticalMax = Math.floor(cpuCount / this.CORES_PER_HEVC_JOB);
    const optimalWorkers = Math.floor(theoreticalMax * this.WORKER_SAFETY_MARGIN);
    const actualWorkers = Math.max(
      this.MIN_WORKERS_PER_NODE,
      Math.min(optimalWorkers, this.MAX_WORKERS_PER_NODE)
    );

    // Calculate what would happen with different margins
    const scenarios = [
      {
        margin: 0.3,
        label: 'Conservative (30%)',
        workers: Math.max(
          this.MIN_WORKERS_PER_NODE,
          Math.min(Math.floor(theoreticalMax * 0.3), this.MAX_WORKERS_PER_NODE)
        ),
        risk: 'low',
        description: 'Lower CPU usage, slower queue processing',
      },
      {
        margin: 0.5,
        label: 'Balanced (50%)',
        workers: actualWorkers,
        risk: 'medium',
        description: 'Optimal balance between speed and stability',
      },
      {
        margin: 0.7,
        label: 'Aggressive (70%)',
        workers: Math.max(
          this.MIN_WORKERS_PER_NODE,
          Math.min(Math.floor(theoreticalMax * 0.7), this.MAX_WORKERS_PER_NODE)
        ),
        risk: 'high',
        description: 'Faster processing, higher crash risk',
      },
    ];

    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();

    return {
      cpu: {
        model: os.cpus()[0]?.model || 'Unknown',
        cores: cpuCount,
        coresPerJob: this.CORES_PER_HEVC_JOB,
        theoreticalMaxWorkers: theoreticalMax,
        safetyMargin: this.WORKER_SAFETY_MARGIN,
        configuredWorkers: actualWorkers,
        minWorkers: this.MIN_WORKERS_PER_NODE,
        maxWorkers: this.MAX_WORKERS_PER_NODE,
      },
      memory: {
        total: totalMemory,
        free: freeMemory,
        used: totalMemory - freeMemory,
        usedPercent: ((totalMemory - freeMemory) / totalMemory) * 100,
      },
      scenarios,
      recommendation: {
        current: 'balanced',
        reason:
          'Provides optimal balance between encoding speed and system stability. Prevents resource oversubscription while maximizing throughput.',
      },
    };
  }
}
