import { Module } from '@nestjs/common';
import { DashboardController, PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { PolicySharesController } from './policy-shares.controller';
import { PolicySharesService } from './policy-shares.service';

@Module({
  controllers: [
    PoliciesController,
    PolicySharesController,
    DashboardController,
  ],
  providers: [PoliciesService, PolicySharesService],
})
export class PoliciesModule {}
