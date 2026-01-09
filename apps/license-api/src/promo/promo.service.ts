import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreatePromoCodeDto {
  code: string;
  description: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  validFrom: Date;
  validUntil: Date;
  maxUses?: number;
}

export interface UpdatePromoCodeDto {
  description?: string;
  validFrom?: Date;
  validUntil?: Date;
  maxUses?: number;
  isActive?: boolean;
}

export interface PromoValidationResult {
  valid: boolean;
  discount?: number;
  discountType?: string;
  code?: string;
}

@Injectable()
export class PromoService {
  constructor(private readonly prisma: PrismaService) {}

  async createPromoCode(dto: CreatePromoCodeDto, adminUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const promo = await tx.promoCode.create({
        data: {
          code: dto.code.toUpperCase(),
          description: dto.description,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          validFrom: dto.validFrom,
          validUntil: dto.validUntil,
          maxUses: dto.maxUses,
          createdBy: adminUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'CREATE_PROMO_CODE',
          entityType: 'PROMO_CODE',
          entityId: promo.id,
          userId: adminUserId,
          changes: { code: promo.code },
        },
      });

      return promo;
    });
  }

  async updatePromoCode(id: string, dto: UpdatePromoCodeDto, adminUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const promo = await tx.promoCode.update({
        where: { id },
        data: dto,
      });

      await tx.auditLog.create({
        data: {
          action: 'UPDATE_PROMO_CODE',
          entityType: 'PROMO_CODE',
          entityId: id,
          userId: adminUserId,
          changes: JSON.parse(JSON.stringify(dto)),
        },
      });

      return promo;
    });
  }

  async deactivatePromoCode(id: string, adminUserId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.promoCode.update({
        where: { id },
        data: { isActive: false },
      });

      await tx.auditLog.create({
        data: {
          action: 'DEACTIVATE_PROMO_CODE',
          entityType: 'PROMO_CODE',
          entityId: id,
          userId: adminUserId,
        },
      });
    });
  }

  async getAllPromoCodes() {
    return this.prisma.promoCode.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPromoCodeById(id: string) {
    const promo = await this.prisma.promoCode.findUnique({
      where: { id },
    });

    if (!promo) {
      throw new NotFoundException('Promo code not found');
    }

    return promo;
  }

  async validateAndIncrementPromoCode(code: string): Promise<PromoValidationResult> {
    const upperCode = code.toUpperCase();

    try {
      // Atomic update with conditional WHERE clause
      const promo = await this.prisma.$transaction(async (tx) => {
        // First, find the promo to check validity
        const existingPromo = await tx.promoCode.findUnique({
          where: { code: upperCode },
        });

        if (!existingPromo) {
          return null;
        }

        if (!existingPromo.isActive) {
          throw new Error('INACTIVE');
        }

        const now = new Date();
        if (now < existingPromo.validFrom || now > existingPromo.validUntil) {
          throw new Error('EXPIRED');
        }

        if (existingPromo.maxUses && existingPromo.currentUses >= existingPromo.maxUses) {
          throw new Error('MAX_USES_REACHED');
        }

        // Atomic increment with validation
        const updated = await tx.promoCode.update({
          where: {
            code: upperCode,
          },
          data: {
            currentUses: { increment: 1 },
          },
        });

        return updated;
      });

      if (!promo) {
        return { valid: false };
      }

      return {
        valid: true,
        discount: promo.discountValue,
        discountType: promo.discountType,
        code: promo.code,
      };
    } catch (error: any) {
      if (error.message === 'INACTIVE') {
        return { valid: false };
      }
      if (error.message === 'EXPIRED') {
        return { valid: false };
      }
      if (error.message === 'MAX_USES_REACHED') {
        return { valid: false };
      }
      return { valid: false };
    }
  }

  async decrementPromoCode(code: string): Promise<void> {
    await this.prisma.promoCode.update({
      where: { code: code.toUpperCase() },
      data: {
        currentUses: { decrement: 1 },
      },
    });
  }

  // Deprecated: Use validateAndIncrementPromoCode instead
  async validatePromoCode(code: string): Promise<PromoValidationResult> {
    const promo = await this.prisma.promoCode.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!promo || !promo.isActive) {
      return { valid: false };
    }

    const now = new Date();
    if (now < promo.validFrom || now > promo.validUntil) {
      return { valid: false };
    }

    if (promo.maxUses && promo.currentUses >= promo.maxUses) {
      return { valid: false };
    }

    return {
      valid: true,
      discount: promo.discountValue,
      discountType: promo.discountType,
      code: promo.code,
    };
  }

  // Deprecated: Use validateAndIncrementPromoCode instead
  async incrementUsage(code: string): Promise<void> {
    await this.prisma.promoCode.update({
      where: { code: code.toUpperCase() },
      data: {
        currentUses: {
          increment: 1,
        },
      },
    });
  }
}
