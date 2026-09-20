import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Param, Post, Query, Req, Res, Sse } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { QueueService } from '../../application/queue.service';
import { QueueError } from '../../domain/queue-errors';
import type { QueueAction, QueueFilters } from '../../domain/queue';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { QueueActionDto, QueueAttemptsQueryDto, QueueListQueryDto } from './queue.dto';

@Controller('v1/queue')
export class QueueController {
  constructor(@Inject(QueueService) private readonly queue: QueueService) {}
  @Get('jobs') list(@Query() query: QueueListQueryDto) { return this.run(() => this.queue.list(query as QueueFilters)); }
  @Get('jobs/:id') async detail(@Param('id') id: string, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.queue.detail(id)); response.header('ETag', etag(result.version)); return result; }
  @Get('jobs/:id/attempts') attempts(@Param('id') id: string, @Query() query: QueueAttemptsQueryDto) { return this.run(() => this.queue.attempts(id, query.cursor, query.limit)); }
  @Sse('events') events() { return this.queue.events(); }
  @Post('jobs/:id/cancel') @HttpCode(HttpStatus.OK) cancel(@Param('id') id: string, @Headers('if-match') match: string | undefined, @Headers('idempotency-key') key: string | undefined, @Body() body: QueueActionDto, @Req() request: FastifyRequest & { requestId?: string }, @Res({ passthrough: true }) response: FastifyReply) { return this.mutate(() => this.queue.cancel(id, version(match), requiredKey(key), body as QueueAction, request.requestId), response); }
  @Post('jobs/:id/retry') @HttpCode(HttpStatus.OK) retry(@Param('id') id: string, @Headers('if-match') match: string | undefined, @Headers('idempotency-key') key: string | undefined, @Body() body: QueueActionDto, @Req() request: FastifyRequest & { requestId?: string }, @Res({ passthrough: true }) response: FastifyReply) { return this.mutate(() => this.queue.retry(id, version(match), requiredKey(key), body as QueueAction, request.requestId), response); }
  private async mutate(action: () => Promise<{ version: number }>, response: FastifyReply) { const result = await this.run(action); response.header('ETag', etag(result.version)); return result; }
  private async run<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch (error) { if (!(error instanceof QueueError)) throw error; const status = error.code === 'QUEUE_JOB_NOT_FOUND' ? 404 : error.code === 'VERSION_CONFLICT' ? 412 : ['JOB_NOT_CANCELLABLE', 'JOB_NOT_RETRYABLE', 'JOB_RETRY_CONFLICT', 'IDEMPOTENCY_KEY_REUSED'].includes(error.code) ? 409 : 400; throw new ProblemDetailsException(status, error.code, error.message); } }
}
function version(value?: string) { const match = /^"([1-9]\d*)"$/u.exec(value ?? ''); if (!match) throw new BadRequestException('If-Match must be a strong numeric ETag'); return Number(match[1]); }
function requiredKey(value?: string) { if (!value) throw new BadRequestException('Idempotency-Key is required'); return value; }
function etag(version: number) { return `"${version}"`; }
