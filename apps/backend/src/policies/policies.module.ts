import { Module } from '@nestjs/common';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { PolicyRepository } from './repositories/policy.repository';

@Module({
  controllers: [PoliciesController],
  providers: [PoliciesService, PolicyRepository],
  exports: [PoliciesService],
})
export class PoliciesModule {}
