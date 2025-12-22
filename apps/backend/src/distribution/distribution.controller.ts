import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { AssignJobDto, UpdateConfigDto } from './dto/distribution.dto';
import { DistributionOrchestratorService } from './services/distribution-orchestrator.service';
import { LoadMonitorService } from './services/load-monitor.service';
import { ReliabilityTrackerService } from './services/reliability-tracker.service';

/**
 * Distribution Controller (v2)
 *
 * API endpoints for the enhanced job distribution algorithm.
 *
 * Endpoints:
 * - GET /scores/:jobId - Get all node scores for a job
 * - GET /scores/:jobId/:nodeId - Get detailed score for specific node
 * - POST /assign/:jobId - Assign or migrate a job to optimal node
 * - POST /rebalance - Rebalance all queued jobs
 * - GET /config - Get current distribution config
 * - PUT /config - Update distribution config weights
 * - GET /summary - Get distribution summary for dashboard
 * - GET /reliability/:nodeId - Get reliability stats for a node
 */
@ApiTags('Distribution')
@Controller('distribution')
export class DistributionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: DistributionOrchestratorService,
    private readonly loadMonitor: LoadMonitorService,
    private readonly reliabilityTracker: ReliabilityTrackerService
  ) {}

  @Get('scores/:jobId')
  @ApiOperation({
    summary: 'Get all node scores for a job',
    description:
      'Returns scores for all online nodes for the specified job, sorted by score descending.',
  })
  @ApiParam({ name: 'jobId', description: 'Job ID to score' })
  @ApiResponse({ status: 200, description: 'Node scores returned successfully' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getNodeScores(@Param('jobId') jobId: string) {
    const scores = await this.orchestrator.getAllNodeScores(jobId);

    if (scores.length === 0) {
      throw new HttpException('Job not found or no online nodes', HttpStatus.NOT_FOUND);
    }

    return {
      jobId,
      scores: scores.map((score) => ({
        nodeId: score.nodeId,
        nodeName: score.nodeName,
        totalScore: Math.round(score.totalScore * 10) / 10,
        factors: score.factors,
        breakdown: this.orchestrator.getScoreBreakdown(score),
        computedAt: score.computedAt,
      })),
    };
  }

  @Get('scores/:jobId/:nodeId')
  @ApiOperation({
    summary: 'Get detailed score for a specific node',
    description: 'Returns detailed scoring breakdown for a specific job-node pair.',
  })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiParam({ name: 'nodeId', description: 'Node ID' })
  async getNodeScoreDetail(@Param('jobId') jobId: string, @Param('nodeId') nodeId: string) {
    const scores = await this.orchestrator.getAllNodeScores(jobId);
    const nodeScore = scores.find((s) => s.nodeId === nodeId);

    if (!nodeScore) {
      throw new HttpException('Node score not found', HttpStatus.NOT_FOUND);
    }

    return {
      jobId,
      nodeId,
      nodeName: nodeScore.nodeName,
      totalScore: Math.round(nodeScore.totalScore * 10) / 10,
      factors: nodeScore.factors,
      breakdown: this.orchestrator.getScoreBreakdown(nodeScore),
      computedAt: nodeScore.computedAt,
    };
  }

  @Post('assign/:jobId')
  @ApiOperation({
    summary: 'Assign or migrate a job to a node',
    description: 'Assigns a job to the optimal node, or to a specific node if nodeId is provided.',
  })
  @ApiParam({ name: 'jobId', description: 'Job ID to assign' })
  @ApiResponse({ status: 200, description: 'Job assigned successfully' })
  @ApiResponse({ status: 404, description: 'Job or node not found' })
  async assignJob(@Param('jobId') jobId: string, @Body() dto: AssignJobDto) {
    const result = await this.orchestrator.assignJob(jobId, dto.nodeId);

    if (!result) {
      throw new HttpException('Failed to assign job', HttpStatus.NOT_FOUND);
    }

    return result;
  }

  @Post('rebalance')
  @ApiOperation({
    summary: 'Rebalance queued jobs across nodes',
    description:
      'Analyzes all queued jobs and migrates them to better nodes if significant score improvement is possible.',
  })
  @ApiResponse({ status: 200, description: 'Rebalance complete' })
  async rebalanceJobs() {
    const result = await this.orchestrator.rebalanceJobs();

    return {
      success: true,
      migratedCount: result.migratedCount,
      reasons: result.reasons,
    };
  }

  @Get('config')
  @ApiOperation({
    summary: 'Get distribution configuration',
    description: 'Returns current scoring weights and behavior settings.',
  })
  async getConfig() {
    let config = await this.prisma.distributionConfig.findFirst({
      where: { isActive: true },
    });

    if (!config) {
      config = await this.prisma.distributionConfig.create({
        data: { id: 'default' },
      });
    }

    return config;
  }

  @Put('config')
  @ApiOperation({
    summary: 'Update distribution configuration',
    description: 'Update scoring weights and behavior settings.',
  })
  @ApiResponse({ status: 200, description: 'Config updated successfully' })
  async updateConfig(@Body() dto: UpdateConfigDto) {
    let config = await this.prisma.distributionConfig.findFirst({
      where: { isActive: true },
    });

    if (!config) {
      config = await this.prisma.distributionConfig.create({
        data: { id: 'default' },
      });
    }

    const updated = await this.prisma.distributionConfig.update({
      where: { id: config.id },
      data: dto,
    });

    return updated;
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Get distribution summary',
    description: 'Returns summary of job distribution across nodes for dashboard.',
  })
  async getSummary() {
    return this.orchestrator.getDistributionSummary();
  }

  @Get('reliability/:nodeId')
  @ApiOperation({
    summary: 'Get reliability stats for a node',
    description: 'Returns failure statistics for the specified node.',
  })
  @ApiParam({ name: 'nodeId', description: 'Node ID' })
  async getNodeReliability(@Param('nodeId') nodeId: string) {
    const summary = await this.reliabilityTracker.getFailureSummary(nodeId);
    const isUnreliable = this.reliabilityTracker.isUnreliable(
      summary.count24h,
      summary.failureRate
    );

    return {
      nodeId,
      ...summary,
      isUnreliable,
    };
  }

  @Get('capacity')
  @ApiOperation({
    summary: 'Get capacity status for all nodes',
    description: 'Returns current capacity and load status for all online nodes.',
  })
  async getNodesCapacity() {
    const nodes = await this.prisma.node.findMany({
      where: { status: 'ONLINE' },
      select: { id: true, name: true },
    });

    const capacities = [];
    for (const node of nodes) {
      const capacity = await this.loadMonitor.getNodeCapacity(node.id);
      if (capacity) {
        capacities.push(capacity);
      }
    }

    return { nodes: capacities };
  }

  @Post('simulate/:jobId')
  @ApiOperation({
    summary: 'Simulate job assignment (dry run)',
    description: 'Returns what node would be selected for a job without actually assigning it.',
  })
  @ApiParam({ name: 'jobId', description: 'Job ID to simulate' })
  async simulateAssignment(@Param('jobId') jobId: string) {
    const result = await this.orchestrator.findOptimalNode(jobId);

    if (!result) {
      throw new HttpException('No eligible nodes found', HttpStatus.NOT_FOUND);
    }

    return {
      simulation: true,
      ...result,
    };
  }
}
