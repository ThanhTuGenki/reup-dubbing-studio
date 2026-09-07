import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './infra/prisma/prisma.module';
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
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { loggingOptions } from './common/logging';

@Module({
  imports: [
    LoggerModule.forRoot(loggingOptions()),
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
})
export class AppModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
