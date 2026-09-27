import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { AesGcmCredentialCipher } from '../settings';
import { WorkerTasksService } from './application/worker-tasks.service';
import { WorkersService } from './application/workers.service';
import { WorkerAgentController } from './http/worker/worker-agent.controller';
import { WorkerTasksController } from './http/worker/worker-tasks.controller';
import { WorkersController } from './http/web/workers.controller';
import { PrismaWorkerTasksRepository } from './infrastructure/prisma-worker-tasks-repository';
import { PrismaWorkersRepository } from './infrastructure/prisma-workers-repository';
import { R2WorkerObjectStore } from './infrastructure/r2-worker-object-store';
import { PipelineOrchestrator } from './infrastructure/pipeline-orchestrator';
import { ControlPlaneRunner } from './application/control-plane-runner';

@Module({})
export class WorkersModule { static register(config: Pick<AppConfig, 'databaseUrl' | 'settingsEncryptionKey' | 'nodeEnv' | 'contentAgentBaseUrls'>): DynamicModule { return { module: WorkersModule, controllers: [WorkersController, WorkerAgentController, WorkerTasksController], providers: [{ provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) }, { provide: AesGcmCredentialCipher, useFactory: () => new AesGcmCredentialCipher(config.settingsEncryptionKey) }, { provide: R2WorkerObjectStore, inject: [PrismaService, AesGcmCredentialCipher], useFactory: (prisma: PrismaService, cipher: AesGcmCredentialCipher) => new R2WorkerObjectStore(prisma, cipher) }, { provide: PipelineOrchestrator, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PipelineOrchestrator(prisma) }, { provide: ControlPlaneRunner, inject: [PrismaService, R2WorkerObjectStore, AesGcmCredentialCipher, PipelineOrchestrator], useFactory: (prisma: PrismaService, objects: R2WorkerObjectStore, cipher: AesGcmCredentialCipher, orchestrator: PipelineOrchestrator) => new ControlPlaneRunner(prisma, objects, cipher, orchestrator, config.nodeEnv !== 'test', config.contentAgentBaseUrls) }, { provide: PrismaWorkerTasksRepository, inject: [PrismaService, R2WorkerObjectStore, PipelineOrchestrator], useFactory: (prisma: PrismaService, objects: R2WorkerObjectStore, orchestrator: PipelineOrchestrator) => new PrismaWorkerTasksRepository(prisma, objects, orchestrator) }, { provide: PrismaWorkersRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaWorkersRepository(prisma) }, { provide: WorkerTasksService, inject: [PrismaWorkerTasksRepository], useFactory: (repository: PrismaWorkerTasksRepository) => new WorkerTasksService(repository, config.settingsEncryptionKey) }, { provide: WorkersService, inject: [PrismaWorkersRepository], useFactory: (repository: PrismaWorkersRepository) => new WorkersService(repository, config.settingsEncryptionKey) }] }; } }
