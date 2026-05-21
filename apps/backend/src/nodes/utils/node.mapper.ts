import type { NodeRegistrationRequest, Node as PrismaNode } from '@prisma/client';
import type { CurrentNodeDto } from '../dto/current-node.dto';
import type { NodeResponseDto } from '../dto/node-response.dto';
import type { RegistrationRequestResponseDto } from '../dto/registration/registration-request-response.dto';

/**
 * Node Entity to DTO Mapping Utilities
 *
 * Converts Prisma Node entities to safe DTOs by excluding sensitive fields
 * and ensuring proper type safety across controller responses.
 */

/**
 * Converts Prisma Node to safe NodeResponseDto
 * Excludes sensitive fields: apiKey, pairingToken, pairingExpiresAt, licenseId
 */
export function toNodeResponseDto(node: PrismaNode): NodeResponseDto {
  return {
    id: node.id,
    name: node.name,
    role: node.role,
    status: node.status,
    version: node.version,
    acceleration: node.acceleration,
    lastHeartbeat: node.lastHeartbeat,
    uptimeSeconds: node.uptimeSeconds,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    maxWorkers: node.maxWorkers,
    cpuLimit: node.cpuLimit,
  };
}

/**
 * Converts Prisma Node to CurrentNodeDto
 * Returns minimal fields needed for current node identification
 */
export function toCurrentNodeDto(node: PrismaNode): CurrentNodeDto {
  return {
    id: node.id,
    name: node.name,
    role: node.role,
    status: node.status,
    version: node.version,
    acceleration: node.acceleration,
    mainNodeUrl: node.mainNodeUrl,
  };
}

/**
 * Batch converts array of Prisma Nodes to NodeResponseDto array
 */
export function toNodeResponseDtoArray(nodes: PrismaNode[]): NodeResponseDto[] {
  return nodes.map(toNodeResponseDto);
}

/**
 * Converts Prisma NodeRegistrationRequest to RegistrationRequestResponseDto
 * Handles JSON hardwareSpecs field type conversion
 */
export function toRegistrationRequestResponseDto(
  request: NodeRegistrationRequest
): RegistrationRequestResponseDto {
  return {
    id: request.id,
    childNodeName: request.childNodeName,
    childVersion: request.childVersion,
    ipAddress: request.ipAddress,
    hostname: request.hostname,
    containerType: request.containerType,
    hardwareSpecs: request.hardwareSpecs as {
      cpuCores: number;
      cpuModel: string;
      ramGb: number;
      diskGb: number;
      gpuModel: string | null;
    },
    acceleration: request.acceleration,
    pairingToken: request.pairingToken,
    tokenExpiresAt: request.tokenExpiresAt,
    status: request.status,
    requestedAt: request.createdAt,
    respondedAt: request.updatedAt !== request.createdAt ? request.updatedAt : undefined,
    message: request.message || undefined,
    rejectionReason: request.rejectionReason || undefined,
    childNodeId: request.childNodeId || undefined,
    // Note: apiKey is not in NodeRegistrationRequest model, only returned manually on approval
    apiKey: undefined,
  };
}

/**
 * Batch converts array of NodeRegistrationRequest to RegistrationRequestResponseDto array
 */
export function toRegistrationRequestResponseDtoArray(
  requests: NodeRegistrationRequest[]
): RegistrationRequestResponseDto[] {
  return requests.map(toRegistrationRequestResponseDto);
}
