import { DefaultPaths } from './default-paths.model';
import { HardwareAcceleration } from './hardware-acceleration.model';
import { SystemInfo } from './system-info.model';

export interface EnvironmentInfo {
  environment: 'UNRAID' | 'DOCKER' | 'BARE_METAL';
  isUnraid: boolean;
  isDocker: boolean;
  hardwareAcceleration: HardwareAcceleration;
  defaultPaths: DefaultPaths;
  systemInfo: SystemInfo;
  docsLink: string;
  recommendations: string[];
}
