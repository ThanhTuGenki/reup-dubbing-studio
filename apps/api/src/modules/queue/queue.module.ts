import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { QueueService } from './application/queue.service';
import { QueueController } from './http/web/queue.controller';
import { PrismaQueueRepository } from './infrastructure/prisma-queue-repository';

@Module({})
export class QueueModule { static register(config: Pick<AppConfig, 'databaseUrl'>): DynamicModule { return { module: QueueModule, controllers: [QueueController], providers: [{ provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) }, { provide: PrismaQueueRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaQueueRepository(prisma) }, { provide: QueueService, inject: [PrismaQueueRepository], useFactory: (repository: PrismaQueueRepository) => new QueueService(repository) }] }; } }
