export interface SystemResources {
  cpu: {
    model: string;
    cores: number;
    coresPerJob: number;
    theoreticalMaxWorkers: number;
    safetyMargin: number;
    configuredWorkers: number;
    minWorkers: number;
    maxWorkers: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
  };
  scenarios: Array<{
    margin: number;
    label: string;
    workers: number;
    risk: string;
    description: string;
  }>;
  recommendation: {
    current: string;
    reason: string;
  };
}
