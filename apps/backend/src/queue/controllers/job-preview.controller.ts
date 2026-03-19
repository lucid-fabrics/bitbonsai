import * as path from 'node:path';
import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { type Job, JobStage } from '@prisma/client';
import { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { firstValueFrom } from 'rxjs';
import { NodeConfigService } from '../../core/services/node-config.service';
import { EncodingPreviewService } from '../../encoding/encoding-preview.service';
import { QueueService } from '../queue.service';

@ApiTags('queue')
@Controller('queue')
export class JobPreviewController {
  private readonly logger = new Logger(JobPreviewController.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly nodeConfig: NodeConfigService,
    private readonly httpService: HttpService,
    private readonly previewService: EncodingPreviewService
  ) {}

  /**
   * Get preview image for a job
   */
  @Get(':id/preview/:index')
  @ApiOperation({
    summary: 'Get encoding preview image',
    description:
      'Serves a preview screenshot image generated during encoding.\n\n' +
      '**Preview System**:\n' +
      '- Generates 9 preview screenshots at 10%, 20%, 30%, 40%, 50%, 60%, 70%, 80%, 90%\n' +
      '- Updates every 30 seconds during encoding\n' +
      '- Stored in `/tmp/bitbonsai-previews/{jobId}/`\n' +
      '- Automatically cleaned up when job completes/fails\n\n' +
      '**Index Parameter**:\n' +
      '- **1-9**: Preview at 10%, 20%, ..., 90% progress\n\n' +
      '**Use Case**: Display live encoding previews in UI carousel',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiParam({
    name: 'index',
    description: 'Preview image index (1-9)',
    example: '1',
  })
  @ApiOkResponse({
    description: 'Preview image served successfully',
    schema: {
      type: 'string',
      format: 'binary',
    },
  })
  @ApiNotFoundResponse({
    description: 'Job not found or preview image does not exist',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while serving preview',
  })
  async getPreviewImage(
    @Param('id') id: string,
    @Param('index') index: string,
    @Res({ passthrough: false }) res: Response
  ): Promise<void> {
    // MULTI-NODE: LINKED nodes should proxy preview requests to MAIN node
    const mainApiUrl = this.nodeConfig.getMainApiUrl();
    if (mainApiUrl) {
      const url = `${mainApiUrl}/api/v1/queue/${id}/preview/${index}`;
      this.logger.debug(`🔍 MULTI-NODE: Proxying preview request to MAIN: ${url}`);

      try {
        const response = await firstValueFrom(
          this.httpService.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
          })
        );

        // If no content (204), return same
        if (response.status === 204) {
          res.status(204).send();
          return;
        }

        // Forward the image
        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.setHeader('Cache-Control', 'no-store');
        res.send(Buffer.from(response.data));
        return;
      } catch (error: unknown) {
        // Handle 204 No Content from MAIN
        if (error && typeof error === 'object' && 'response' in error) {
          const axiosError = error as { response?: { status?: number } };
          if (axiosError.response?.status === 204) {
            res.status(204).send();
            return;
          }
        }
        this.logger.debug(`Preview not available from MAIN for job ${id}`);
        res.status(204).send();
        return;
      }
    }

    // Verify job exists
    const job = await this.queueService.findOne(id);

    // Parse and validate preview index
    const previewIndex = parseInt(index, 10);
    if (Number.isNaN(previewIndex) || previewIndex < 1 || previewIndex > 9) {
      throw new NotFoundException(`Invalid preview index. Must be between 1 and 9.`);
    }

    // MEDIUM #8 FIX: Safe JSON parsing for preview paths
    let previewPaths: string[] = [];
    if (job.previewImagePaths) {
      try {
        previewPaths = JSON.parse(job.previewImagePaths);
      } catch (parseError: unknown) {
        this.logger.warn(`Failed to parse preview paths for job ${id}: ${parseError}`);
        previewPaths = [];
      }
    }

    // Get the requested preview path (1-indexed to 0-indexed)
    const previewPath = previewPaths[previewIndex - 1];

    // BUGFIX: Return 204 No Content instead of 404 when preview doesn't exist
    // This prevents error spam in logs for jobs with old/stale preview paths
    // Frontend already handles image loading errors gracefully
    if (!previewPath || !existsSync(previewPath)) {
      this.logger.debug(
        `Preview image ${previewIndex} not available for job ${id} (path: ${previewPath || 'undefined'})`
      );

      // Clean up only the missing paths from DB (not all of them)
      // This handles stale /tmp paths from older versions while preserving valid NFS paths
      if (previewPaths.length > 0) {
        const validPaths = previewPaths.filter((p) => existsSync(p));
        if (validPaths.length !== previewPaths.length) {
          this.logger.debug(
            `Cleaning ${previewPaths.length - validPaths.length} stale preview paths for job ${id} (keeping ${validPaths.length} valid)`
          );
          this.queueService.updateJobPreview(id, validPaths).catch((err) => {
            this.logger.warn(`Failed to clean stale preview paths for job ${id}:`, err);
          });
        }
      }

      res.status(204).send();
      return;
    }

    // Path traversal protection: verify resolved path is within preview directory
    const previewDir = process.env.PREVIEW_DIR || '/previews';
    const resolvedPath = path.resolve(previewPath);
    const resolvedPreviewDir = path.resolve(previewDir);
    if (!resolvedPath.startsWith(resolvedPreviewDir)) {
      this.logger.warn(`Path traversal attempt blocked for job ${id}: ${previewPath}`);
      res.status(204).send();
      return;
    }

    // Serve the image file with stream error handling
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');

    const fileStream = createReadStream(previewPath);
    fileStream.on('error', (err) => {
      this.logger.debug(`Failed to stream preview for job ${id}: ${err.message}`);
      if (!res.headersSent) {
        res.status(204).send();
      }
    });
    fileStream.pipe(res);
  }

  /**
   * Manually capture a preview screenshot at current encoding progress
   */
  @Post(':id/preview/capture')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually capture preview at current progress',
    description:
      'Captures a preview screenshot from the temp file at the current encoding progress.\n\n' +
      '**Use Case**: User clicks "Capture Now" button to get a snapshot of current encoding progress.\n\n' +
      '**Requirements**:\n' +
      '- Job must be in ENCODING stage\n' +
      '- Temp file must exist\n' +
      '- Returns updated job with new preview path added to previewImagePaths array',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Preview captured successfully, returns updated job',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'Job is not in ENCODING stage or temp file does not exist',
  })
  async capturePreview(@Param('id') id: string): Promise<Job> {
    const job = await this.queueService.findOne(id);

    // Verify job is in ENCODING stage
    if (job.stage !== JobStage.ENCODING) {
      throw new BadRequestException(
        `Cannot capture preview. Job is in ${job.stage} stage (must be ENCODING)`
      );
    }

    // Verify source file exists
    if (!job.filePath || !existsSync(job.filePath)) {
      throw new BadRequestException('Cannot capture preview. Source file does not exist');
    }

    if (job.progress === null || job.progress === undefined) {
      throw new BadRequestException('Cannot capture preview. Missing progress information');
    }

    // Delegate ffprobe + ffmpeg work to EncodingPreviewService
    let manualPreviewPath: string;
    try {
      manualPreviewPath = await this.previewService.captureManualPreview(
        job.id,
        job.filePath,
        job.progress
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(errorMessage);
    }

    // MEDIUM #8 FIX: Safe JSON parsing for existing preview paths
    let existingPaths: string[] = [];
    if (job.previewImagePaths) {
      try {
        existingPaths = JSON.parse(job.previewImagePaths);
      } catch (parseError: unknown) {
        this.logger.warn(`Failed to parse existing preview paths for job ${id}: ${parseError}`);
        existingPaths = [];
      }
    }

    // Add new manual preview path to existing array
    const updatedPaths = [...existingPaths, manualPreviewPath];

    return await this.queueService.update(job.id, {
      previewImagePaths: JSON.stringify(updatedPaths),
    });
  }
}
