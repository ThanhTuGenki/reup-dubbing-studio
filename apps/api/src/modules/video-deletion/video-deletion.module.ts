import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { VideoDeletionService } from './application/video-deletion.service';
import { VideoDeletionController } from './http/web/video-deletion.controller';
import { PrismaVideoDeletionRepository } from './infrastructure/prisma-video-deletion-repository';

@Module({})
export class VideoDeletionModule { static register(config: Pick<AppConfig, 'databaseUrl'>): DynamicModule { return { module: VideoDeletionModule, controllers: [VideoDeletionController], providers: [{ provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) }, { provide: PrismaVideoDeletionRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaVideoDeletionRepository(prisma) }, { provide: VideoDeletionService, inject: [PrismaVideoDeletionRepository], useFactory: (repository: PrismaVideoDeletionRepository) => new VideoDeletionService(repository) }] }; } }
