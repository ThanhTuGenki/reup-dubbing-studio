import { Module } from '@nestjs/common';

import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { ShutdownService } from './infra/process/shutdown.service';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ContentModule } from './modules/content/content.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PublishingModule } from './modules/publishing/publishing.module';
import { ReviewModule } from './modules/review/review.module';
import { StorageModule } from './modules/storage/storage.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TranslationModule } from './modules/translation/translation.module';
import { VideosModule } from './modules/videos/videos.module';
import { VoiceProfilesModule } from './modules/voice-profiles/voice-profiles.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { WorkersModule } from './modules/workers/workers.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    DiscoveryModule,
    VideosModule,
    WorkflowModule,
    TasksModule,
    WorkersModule,
    VoiceProfilesModule,
    ReviewModule,
    PublishingModule,
    StorageModule,
    NotificationsModule,
    AuditModule,
    TranslationModule,
    ContentModule,
  ],
  providers: [ShutdownService],
})
export class AppModule {}
