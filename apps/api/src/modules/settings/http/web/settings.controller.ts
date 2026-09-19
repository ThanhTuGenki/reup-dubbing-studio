import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { SettingsService } from '../../application/settings.service';
import type { SettingsPatch } from '../../domain/settings';
import { SettingsError } from '../../domain/settings-errors';
// Runtime DTO imports are required by emitDecoratorMetadata and the global validation pipe.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TestContentAgentDto, TestStorageDto, UpdateSettingsDto } from './settings.dto';

@Controller('v1/settings')
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get()
  async get(@Res({ passthrough: true }) response: FastifyReply) {
    const result = await this.settings.get();
    response.header('ETag', etag(result.version));
    return result;
  }

  @Patch()
  async update(
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: UpdateSettingsDto,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const version = parseEtag(ifMatch);
    if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key must be a UUID');
    }
    try {
      const result = await this.settings.update(version, idempotencyKey, body as SettingsPatch);
      response.header('ETag', etag(result.version));
      return result;
    } catch (error) {
      throw mapSettingsError(error);
    }
  }

  @Post('tests/content-agent')
  async testContentAgent(@Body() body: TestContentAgentDto) {
    try {
      const credential = contentCredential(body.credential);
      return await this.settings.testContentAgent({ provider: body.provider, model: body.model, credential });
    } catch (error) {
      throw mapSettingsError(error);
    }
  }

  @Post('tests/storage')
  async testStorage(@Body() body: TestStorageDto) {
    try {
      const credential = storageCredential(body.credential);
      return await this.settings.testStorage({ accountId: body.accountId, bucket: body.bucket, credential });
    } catch (error) {
      throw mapSettingsError(error);
    }
  }
}

function etag(version: number): string { return `"${version}"`; }

function parseEtag(value: string | undefined): number {
  const match = /^"([1-9]\d*)"$/u.exec(value ?? '');
  if (!match) throw new BadRequestException('If-Match must contain a strong settings ETag');
  return Number(match[1]);
}

function contentCredential(value: TestContentAgentDto['credential']) {
  if (value.source === 'STORED') return { source: 'STORED' as const };
  if (typeof value.value !== 'string' || !value.value.trim()) throw new BadRequestException('Provided credential is required');
  return { source: 'PROVIDED' as const, value: value.value };
}

function storageCredential(value: TestStorageDto['credential']) {
  if (value.source === 'STORED') return { source: 'STORED' as const };
  if (typeof value.value !== 'object' || value.value === null) throw new BadRequestException('Provided credential is required');
  const pair = value.value as Record<string, unknown>;
  if (typeof pair.accessKeyId !== 'string' || !pair.accessKeyId || typeof pair.secretAccessKey !== 'string' || !pair.secretAccessKey) {
    throw new BadRequestException('Provided credential is invalid');
  }
  return { source: 'PROVIDED' as const, value: { accessKeyId: pair.accessKeyId, secretAccessKey: pair.secretAccessKey } };
}

function mapSettingsError(error: unknown): unknown {
  if (!(error instanceof SettingsError)) return error;
  const status = error.code === 'CONNECTION_TEST_FAILED'
    ? HttpStatus.BAD_GATEWAY
    : error.code === 'SETTINGS_VALIDATION_FAILED'
      ? HttpStatus.UNPROCESSABLE_ENTITY
      : HttpStatus.CONFLICT;
  return new ProblemDetailsException(status, error.code, error.message);
}
