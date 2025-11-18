import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { NFSAutoExportService } from '../../core/services/nfs-auto-export.service';
import { StorageMountService } from '../services/storage-mount.service';
import { StorageShareService } from '../services/storage-share.service';

// TODO: Create DTOs for request/response types
// For now using basic types

@ApiTags('storage-shares')
@ApiBearerAuth('JWT-auth')
@Controller('storage-shares')
export class StorageSharesController {
  constructor(
    private readonly storageShareService: StorageShareService,
    private readonly storageMountService: StorageMountService,
    private readonly nfsAutoExportService: NFSAutoExportService
  ) {}

  /**
   * Create a new storage share
   */
  @Post()
  @ApiOperation({
    summary: 'Create a new storage share',
    description: 'Configure a new NFS or SMB storage share for a node',
  })
  @ApiCreatedResponse({ description: 'Storage share created successfully' })
  @ApiBadRequestResponse({ description: 'Invalid configuration or duplicate mount point' })
  async create(@Body() createDto: any) {
    return this.storageShareService.create(createDto);
  }

  /**
   * Get all storage shares for a node
   */
  @Get('node/:nodeId')
  @ApiOperation({
    summary: 'Get all storage shares for a node',
    description: 'Retrieve all configured storage shares for a specific node',
  })
  @ApiParam({ name: 'nodeId', description: 'Node ID' })
  @ApiOkResponse({ description: 'Storage shares retrieved successfully' })
  async findAllByNode(@Param('nodeId') nodeId: string) {
    return this.storageShareService.findAllByNode(nodeId);
  }

  /**
   * Get mounted shares for a node
   */
  @Get('node/:nodeId/mounted')
  @ApiOperation({
    summary: 'Get mounted shares for a node',
    description: 'Retrieve all currently mounted storage shares for a node',
  })
  @ApiParam({ name: 'nodeId', description: 'Node ID' })
  @ApiOkResponse({ description: 'Mounted shares retrieved successfully' })
  async findMountedByNode(@Param('nodeId') nodeId: string) {
    return this.storageShareService.findMountedByNode(nodeId);
  }

  /**
   * Get storage share by ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get storage share by ID',
    description: 'Retrieve details of a specific storage share',
  })
  @ApiParam({ name: 'id', description: 'Storage share ID' })
  @ApiOkResponse({ description: 'Storage share retrieved successfully' })
  @ApiNotFoundResponse({ description: 'Storage share not found' })
  async findOne(@Param('id') id: string) {
    return this.storageShareService.findOne(id);
  }

  /**
   * Update storage share configuration
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update storage share',
    description: 'Update configuration of an existing storage share',
  })
  @ApiParam({ name: 'id', description: 'Storage share ID' })
  @ApiOkResponse({ description: 'Storage share updated successfully' })
  @ApiNotFoundResponse({ description: 'Storage share not found' })
  async update(@Param('id') id: string, @Body() updateDto: any) {
    return this.storageShareService.update(id, updateDto);
  }

  /**
   * Delete storage share
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete storage share',
    description: 'Remove a storage share configuration (must be unmounted first)',
  })
  @ApiParam({ name: 'id', description: 'Storage share ID' })
  @ApiOkResponse({ description: 'Storage share deleted successfully' })
  @ApiNotFoundResponse({ description: 'Storage share not found' })
  @ApiBadRequestResponse({ description: 'Cannot delete mounted share' })
  async delete(@Param('id') id: string) {
    await this.storageShareService.delete(id);
  }

  /**
   * Mount a storage share
   */
  @Post(':id/mount')
  @ApiOperation({
    summary: 'Mount a storage share',
    description: 'Mount an NFS or SMB share to the local filesystem',
  })
  @ApiParam({ name: 'id', description: 'Storage share ID' })
  @ApiOkResponse({ description: 'Storage share mounted successfully' })
  @ApiNotFoundResponse({ description: 'Storage share not found' })
  async mount(@Param('id') id: string) {
    return this.storageMountService.mount(id);
  }

  /**
   * Unmount a storage share
   */
  @Post(':id/unmount')
  @ApiOperation({
    summary: 'Unmount a storage share',
    description: 'Unmount a currently mounted storage share',
  })
  @ApiParam({ name: 'id', description: 'Storage share ID' })
  @ApiOkResponse({ description: 'Storage share unmounted successfully' })
  @ApiNotFoundResponse({ description: 'Storage share not found' })
  async unmount(@Param('id') id: string, @Body() body?: { force?: boolean }) {
    return this.storageMountService.unmount(id, body?.force ?? false);
  }

  /**
   * Remount a storage share
   */
  @Post(':id/remount')
  @ApiOperation({
    summary: 'Remount a storage share',
    description: 'Unmount and remount a storage share (useful for refreshing connection)',
  })
  @ApiParam({ name: 'id', description: 'Storage share ID' })
  @ApiOkResponse({ description: 'Storage share remounted successfully' })
  @ApiNotFoundResponse({ description: 'Storage share not found' })
  async remount(@Param('id') id: string) {
    return this.storageMountService.remount(id);
  }

  /**
   * Test connectivity to a storage server
   */
  @Post('test-connectivity')
  @ApiOperation({
    summary: 'Test storage server connectivity',
    description: 'Test if a storage server is reachable and supports NFS/SMB',
  })
  @ApiOkResponse({ description: 'Connectivity test completed' })
  async testConnectivity(@Body() body: { serverAddress: string; protocol?: 'NFS' | 'SMB' }) {
    return this.storageMountService.testConnectivity(body.serverAddress, body.protocol as any);
  }

  /**
   * Get node storage statistics
   */
  @Get('node/:nodeId/stats')
  @ApiOperation({
    summary: 'Get storage statistics for a node',
    description: 'Retrieve storage usage and share statistics for a node',
  })
  @ApiParam({ name: 'nodeId', description: 'Node ID' })
  @ApiOkResponse({ description: 'Storage statistics retrieved successfully' })
  async getNodeStats(@Param('nodeId') nodeId: string) {
    return this.storageShareService.getNodeStats(nodeId);
  }

  /**
   * Auto-detect available storage shares
   */
  @Post('node/:nodeId/auto-detect')
  @ApiOperation({
    summary: 'Auto-detect available storage shares',
    description: 'Discover storage shares advertised by other nodes on the network',
  })
  @ApiParam({ name: 'nodeId', description: 'Node ID' })
  @ApiOkResponse({ description: 'Auto-detection completed' })
  async autoDetect(@Param('nodeId') nodeId: string) {
    return this.storageShareService.autoDetectShares(nodeId);
  }

  /**
   * Auto-detect and auto-mount shares from main node
   */
  @Post('node/:nodeId/auto-detect-and-mount')
  @ApiOperation({
    summary: 'Auto-detect and mount storage shares',
    description: 'Discover storage shares from main node and automatically create/mount them',
  })
  @ApiParam({ name: 'nodeId', description: 'Node ID' })
  @ApiOkResponse({ description: 'Auto-detection and mounting completed' })
  async autoDetectAndMount(@Param('nodeId') nodeId: string) {
    return this.storageShareService.autoDetectAndMount(nodeId);
  }

  /**
   * Auto-export Docker volumes (MAIN node only)
   */
  @Post('auto-export-docker-volumes')
  @ApiOperation({
    summary: 'Auto-export Docker volumes as NFS shares',
    description:
      'Detect Docker volume mounts and automatically export them as NFS shares (MAIN node only)',
  })
  @ApiOkResponse({ description: 'Auto-export completed' })
  async autoExportDockerVolumes() {
    await this.nfsAutoExportService.autoExportDockerVolumes();
    return { success: true, message: 'Docker volumes auto-export completed' };
  }

  /**
   * Get disk usage for a share
   */
  @Get(':id/disk-usage')
  @ApiOperation({
    summary: 'Get disk usage for a mounted share',
    description: 'Retrieve disk usage statistics for a currently mounted share',
  })
  @ApiParam({ name: 'id', description: 'Storage share ID' })
  @ApiOkResponse({ description: 'Disk usage retrieved successfully' })
  @ApiNotFoundResponse({ description: 'Storage share not found or not mounted' })
  async getDiskUsage(@Param('id') id: string) {
    const share = await this.storageShareService.findOne(id);

    if (!share.isMounted) {
      throw new Error('Share must be mounted to get disk usage');
    }

    const usage = await this.storageMountService.getDiskUsage(share.mountPoint);

    // Update share with usage stats
    await this.storageShareService.updateUsageStats(id, {
      totalSizeBytes: usage.totalBytes,
      availableSizeBytes: usage.availableBytes,
      usedPercent: usage.usedPercent,
    });

    return usage;
  }
}
