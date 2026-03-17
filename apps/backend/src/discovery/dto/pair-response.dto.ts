import { ApiProperty } from '@nestjs/swagger';

/**
 * Pairing Status
 */
export enum PairingStatus {
  PENDING = 'PENDING',
  WAITING_APPROVAL = 'WAITING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  TIMEOUT = 'TIMEOUT',
  ERROR = 'ERROR',
}

/**
 * Main Node Info
 */
export class MainNodeInfo {
  @ApiProperty({ description: 'Main node ID' })
  id!: string;

  @ApiProperty({ description: 'Main node display name' })
  name!: string;

  @ApiProperty({ description: 'Main node version' })
  version!: string;
}

/**
 * Pair Response DTO
 *
 * Response from pairing request containing status and pairing code.
 * Child node displays the code for user to enter on main node.
 */
export class PairResponseDto {
  @ApiProperty({
    description: 'Current pairing status',
    enum: PairingStatus,
    example: PairingStatus.WAITING_APPROVAL,
  })
  status!: PairingStatus;

  @ApiProperty({
    description: 'Registration request ID - use this to poll for status updates',
    example: 'clq8x9z8x0000qh8x9z8x0000',
    required: false,
  })
  requestId?: string;

  @ApiProperty({
    description: '6-digit pairing code to enter on MAIN node',
    example: '123456',
    required: false,
  })
  pairingCode?: string;

  @ApiProperty({
    description: 'Human-readable message about pairing status',
    example: 'Waiting for approval from main node',
    required: false,
  })
  message?: string;

  @ApiProperty({
    description:
      'Connection token (JWT) for authenticating with main node - only present when approved',
    example: 'bb_a1b2c3d4e5f6...',
    required: false,
  })
  connectionToken?: string;

  @ApiProperty({
    description: 'Main node information - only present when approved',
    type: MainNodeInfo,
    required: false,
  })
  mainNodeInfo?: MainNodeInfo;
}
