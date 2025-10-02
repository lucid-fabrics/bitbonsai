export enum LicenseTier {
  FREE = 'FREE',
  PATREON = 'PATREON',
  COMMERCIAL_PRO = 'COMMERCIAL_PRO',
}

export interface LicenseFeature {
  name: string;
  enabled: boolean;
}

export interface License {
  tier: LicenseTier;
  licenseKey: string;
  email: string;
  validUntil: string;
  maxNodes: number;
  usedNodes: number;
  maxConcurrentJobs: number;
  features: LicenseFeature[];
}

export interface ActivateLicense {
  licenseKey: string;
  email: string;
}
