export interface SystemInfo {
  cpuCores: number;
  architecture: string;
  platform: string;
  totalMemoryGb: number;
  containerRuntime?: string;
  unraidVersion?: string;
}
