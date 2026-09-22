import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { ReviewPolicyService } from './application/review-policy.service';
import { ReviewPolicyController } from './http/web/review-policy.controller';
import { PrismaReviewPolicyRepository } from './infrastructure/prisma-review-policy-repository';

@Module({})
export class ReviewPolicyModule {
  static register(config: Pick<AppConfig, 'databaseUrl'>): DynamicModule {
    return {
      module: ReviewPolicyModule,
      controllers: [ReviewPolicyController],
      providers: [
        { provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) },
        {
          provide: PrismaReviewPolicyRepository,
          inject: [PrismaService],
          useFactory: (prisma: PrismaService) => new PrismaReviewPolicyRepository(prisma),
        },
        {
          provide: ReviewPolicyService,
          inject: [PrismaReviewPolicyRepository],
          useFactory: (repository: PrismaReviewPolicyRepository) => new ReviewPolicyService(repository),
        },
      ],
    };
  }
}
