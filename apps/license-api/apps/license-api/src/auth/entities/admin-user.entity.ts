import { AdminRole } from '@prisma/license-client';

export class AdminUserEntity {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
