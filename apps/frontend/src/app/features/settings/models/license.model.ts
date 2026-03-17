export enum LicenseTier {
  FREE = 'FREE',
  PATREON = 'PATREON',
  PATREON_SUPPORTER = 'PATREON_SUPPORTER',
  PATREON_PLUS = 'PATREON_PLUS',
  PATREON_PRO = 'PATREON_PRO',
  PATREON_ULTIMATE = 'PATREON_ULTIMATE',
  COMMERCIAL_STARTER = 'COMMERCIAL_STARTER',
  COMMERCIAL_PRO = 'COMMERCIAL_PRO',
  COMMERCIAL_ENTERPRISE = 'COMMERCIAL_ENTERPRISE',
}

export interface LicenseFeature {
  name: string;
  enabled: boolean;
}

export interface License {
  tier: LicenseTier;
  licenseKey: string;
  email: string | null;
  validUntil: string | null;
  maxNodes: number;
  usedNodes: number;
  maxConcurrentJobs: number;
  features: LicenseFeature[];
}

export interface LicenseCapabilities {
  tier: LicenseTier;
  maxNodes: number;
  maxConcurrentJobs: number;
  currentNodes: number;
  currentConcurrentJobs: number;
  features: Record<string, boolean>;
  canAddNode: boolean;
  canStartJob: boolean;
  shouldUpgrade?: boolean;
  reason?: string;
  recommendedTier?: LicenseTier;
}

export interface LicenseTierInfo {
  id: LicenseTier;
  name: string;
  price: number;
  priceUnit: 'month' | 'year' | 'once';
  maxNodes: number;
  maxConcurrentJobs: number;
  features: string[];
  badge?: string;
}

export interface ActivateLicense {
  licenseKey: string;
  email: string;
}

export interface LookupLicenseResponse {
  found: boolean;
  license?: {
    tier: string;
    maxNodes: number;
    maxConcurrentJobs: number;
    maskedKey: string;
    expiresAt?: string | null;
  };
}

export interface StripeStatus {
  configured: boolean;
}

export interface StripePlan {
  priceId: string;
  tier: LicenseTier;
  name: string;
  price: number;
  interval: string;
  maxNodes: number;
  maxConcurrentJobs: number;
}

export interface StripeCheckoutResponse {
  sessionId: string;
  url: string;
}
