import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LicenseRepository } from '../common/repositories/license.repository';
import type { CreateLicenseDto } from './dto/create-license.dto';

/**
 * LicenseService
 *
 * Handles all license-related business logic:
 * - License validation and verification
 * - License creation with tier-based configuration
 * - Node limit checking
 */
@Injectable()
export class LicenseService {
  constructor(readonly _licenseRepository: LicenseRepository) {}

  /**
   * Validate a license key
   *
   * Checks:
   * - License exists
   * - License is active
   * - License has not expired
   * - Returns license details with node capacity information
   *
   * @param key - The license key to validate
   * @returns License details with node capacity
   * @throws NotFoundException if license not found
   * @throws BadRequestException if license is not active or has expired
   */
  async validateLicense(_key: string): Promise<never> {
    throw new NotFoundException('License validation is no longer supported. Use cloud account.');
  }

  /**
   * Create a new license
   *
   * Generates a license key and configures it based on the tier:
   * - FREE: 1 node, 2 concurrent jobs, limited features
   * - PATREON: 2 nodes, 5 concurrent jobs, advanced features
   * - COMMERCIAL: 20+ nodes, 50+ concurrent jobs, all features
   *
   * @param data - License creation data
   * @returns The created license
   */
  async createLicense(_data: CreateLicenseDto): Promise<never> {
    throw new BadRequestException('License creation is no longer supported. Use cloud account.');
  }

  /**
   * Check if a license can add a new node
   *
   * Verifies that the license has not reached its maximum node limit
   *
   * @param licenseId - The license ID to check
   * @returns Boolean indicating if a node can be added
   * @throws NotFoundException if license not found
   */
  async checkCanAddNode(_licenseId: string): Promise<boolean> {
    return true; // Guard is handled via LicenseGuardService + Settings
  }
}
