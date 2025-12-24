import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigCryptoService } from './config-crypto.service';

export interface CreateConfigDto {
  key: string;
  value: string;
  displayName: string;
  description?: string;
  isSecret: boolean;
}

export interface UpdateConfigDto {
  value: string;
}

export interface ConfigForDisplay {
  key: string;
  value: string;
  displayName: string;
  description?: string;
  isSecret: boolean;
  updatedAt: Date;
  updatedBy: string;
}

@Injectable()
export class AppConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: ConfigCryptoService
  ) {}

  async getAllConfigs(): Promise<ConfigForDisplay[]> {
    const configs = await this.prisma.appConfig.findMany({
      orderBy: { key: 'asc' },
    });

    return configs.map((config) => ({
      key: config.key,
      value: config.isSecret
        ? this.cryptoService.maskSecret(this.cryptoService.decrypt(config.value))
        : this.cryptoService.decrypt(config.value),
      displayName: config.displayName,
      description: config.description || undefined,
      isSecret: config.isSecret,
      updatedAt: config.updatedAt,
      updatedBy: config.updatedBy,
    }));
  }

  async getConfig(key: string, unmask = false): Promise<ConfigForDisplay> {
    const config = await this.prisma.appConfig.findUnique({
      where: { key },
    });

    if (!config) {
      throw new NotFoundException(`Config key '${key}' not found`);
    }

    const decryptedValue = this.cryptoService.decrypt(config.value);

    return {
      key: config.key,
      value:
        config.isSecret && !unmask ? this.cryptoService.maskSecret(decryptedValue) : decryptedValue,
      displayName: config.displayName,
      description: config.description || undefined,
      isSecret: config.isSecret,
      updatedAt: config.updatedAt,
      updatedBy: config.updatedBy,
    };
  }

  async getConfigValue(key: string): Promise<string> {
    const config = await this.prisma.appConfig.findUnique({
      where: { key },
    });

    if (!config) {
      throw new NotFoundException(`Config key '${key}' not found`);
    }

    return this.cryptoService.decrypt(config.value);
  }

  async setConfig(dto: CreateConfigDto, adminUserId: string): Promise<void> {
    const encryptedValue = this.cryptoService.encrypt(dto.value);

    await this.prisma.$transaction(async (tx) => {
      await tx.appConfig.upsert({
        where: { key: dto.key },
        create: {
          key: dto.key,
          value: encryptedValue,
          displayName: dto.displayName,
          description: dto.description,
          isSecret: dto.isSecret,
          updatedBy: adminUserId,
        },
        update: {
          value: encryptedValue,
          displayName: dto.displayName,
          description: dto.description,
          isSecret: dto.isSecret,
          updatedBy: adminUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'UPDATE_CONFIG',
          entityType: 'APP_CONFIG',
          entityId: dto.key,
          userId: adminUserId,
          changes: {
            key: dto.key,
            isSecret: dto.isSecret,
          },
        },
      });
    });
  }

  async updateConfigValue(key: string, value: string, adminUserId: string): Promise<void> {
    const encryptedValue = this.cryptoService.encrypt(value);

    await this.prisma.$transaction(async (tx) => {
      await tx.appConfig.update({
        where: { key },
        data: {
          value: encryptedValue,
          updatedBy: adminUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'UPDATE_CONFIG_VALUE',
          entityType: 'APP_CONFIG',
          entityId: key,
          userId: adminUserId,
        },
      });
    });
  }

  async deleteConfig(key: string, adminUserId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.appConfig.delete({
        where: { key },
      });

      await tx.auditLog.create({
        data: {
          action: 'DELETE_CONFIG',
          entityType: 'APP_CONFIG',
          entityId: key,
          userId: adminUserId,
        },
      });
    });
  }
}
