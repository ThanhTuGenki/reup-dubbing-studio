import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { WorkersService } from './application/workers.service';
import { WorkerAgentController } from './http/worker/worker-agent.controller';
import { WorkersController } from './http/web/workers.controller';
import { PrismaWorkersRepository } from './infrastructure/prisma-workers-repository';

@Module({})
export class WorkersModule { static register(config: Pick<AppConfig, 'databaseUrl' | 'settingsEncryptionKey'>): DynamicModule { return { module: WorkersModule, controllers: [WorkersController, WorkerAgentController], providers: [{ provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) }, { provide: PrismaWorkersRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaWorkersRepository(prisma) }, { provide: WorkersService, inject: [PrismaWorkersRepository], useFactory: (repository: PrismaWorkersRepository) => new WorkersService(repository, config.settingsEncryptionKey) }] }; } }
