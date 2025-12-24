import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DistributionController } from './distribution.controller';
import { DistributionOrchestratorService } from './services/distribution-orchestrator.service';
import { EtaCalculatorService } from './services/eta-calculator.service';
import { JobScorerService } from './services/job-scorer.service';
import { LoadMonitorService } from './services/load-monitor.service';
import { ReliabilityTrackerService } from './services/reliability-tracker.service';

/**
 * Distribution Module (v2)
 *
 * Provides enhanced job distribution algorithm with 12 scoring factors.
 *
 * Services:
 * - LoadMonitorService: Real-time load tracking from heartbeats
 * - JobScorerService: Comprehensive job-node scoring
 * - EtaCalculatorService: Encoding duration estimation
 * - ReliabilityTrackerService: Failure tracking per node
 * - DistributionOrchestratorService: Main coordinator
 *
 * Exports all services for use by other modules (NodesModule, QueueModule, etc.)
 */
@Module({
  imports: [PrismaModule],
  controllers: [DistributionController],
  providers: [
    LoadMonitorService,
    JobScorerService,
    EtaCalculatorService,
    ReliabilityTrackerService,
    DistributionOrchestratorService,
  ],
  exports: [
    LoadMonitorService,
    JobScorerService,
    EtaCalculatorService,
    ReliabilityTrackerService,
    DistributionOrchestratorService,
  ],
})
export class DistributionModule {}
