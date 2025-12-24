import { SetMetadata } from '@nestjs/common';

export const AUDIT_METADATA_KEY = 'audit';

export interface AuditMetadata {
  entityType: string;
  action?: string;
}

export const Audited = (entityType: string, action?: string) =>
  SetMetadata(AUDIT_METADATA_KEY, { entityType, action } as AuditMetadata);
