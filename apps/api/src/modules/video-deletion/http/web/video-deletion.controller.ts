import { BadRequestException, Body, Controller, Delete, Headers, HttpCode, HttpStatus, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { VideoDeletionService } from '../../application/video-deletion.service';
import { VideoDeletionError } from '../../domain/video-deletion-errors';
// Runtime import is required for Nest validation metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VideoBulkDeletionDto } from './video-deletion.dto';

const STATUS: Partial<Record<VideoDeletionError['code'], number>> = { VIDEO_NOT_FOUND: 404, VIDEO_VERSION_CONFLICT: 412, VIDEO_HAS_PUBLICATION_HISTORY: 409, IDEMPOTENCY_KEY_REUSED: 409, VIDEO_DELETION_VALIDATION_FAILED: 400 };

@Controller('v1/videos')
export class VideoDeletionController {
  constructor(@Inject(VideoDeletionService) private readonly deletions: VideoDeletionService) {}
  @Post('deletions') @HttpCode(HttpStatus.OK) deleteMany(@Body() body: VideoBulkDeletionDto, @Headers('idempotency-key') key: string | undefined, @Req() request: FastifyRequest & { requestId?: string }) { return this.run(() => this.deletions.deleteMany(body.items, requiredKey(key), request.requestId)); }
  @Delete(':videoId') @HttpCode(HttpStatus.ACCEPTED) delete(@Param('videoId') videoId: string, @Headers('if-match') match: string | undefined, @Headers('idempotency-key') key: string | undefined, @Req() request: FastifyRequest & { requestId?: string }) { return this.run(() => this.deletions.delete(videoId, version(match), requiredKey(key), request.requestId)); }
  private async run<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch (error) { if (!(error instanceof VideoDeletionError)) throw error; throw new ProblemDetailsException(STATUS[error.code] ?? 500, error.code, error.message); } }
}
function version(value?: string) { const match = /^"([1-9]\d*)"$/u.exec(value ?? ''); if (!match) throw new BadRequestException('If-Match must be a strong numeric ETag'); return Number(match[1]); }
function requiredKey(value?: string) { if (!value) throw new BadRequestException('Idempotency-Key is required'); return value; }
