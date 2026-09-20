import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Res, Sse } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { WorkersService } from '../../application/workers.service';
import { WorkerError } from '../../domain/worker-errors';
import type { WorkerFilters } from '../../domain/workers';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateImageDto, CreateWorkerDto, WorkerListQueryDto } from '../workers.dto';

@Controller('v1')
export class WorkersController {
  constructor(@Inject(WorkersService) private readonly workers: WorkersService) {}
  @Get('workers') list(@Query() query: WorkerListQueryDto) { return this.run(() => this.workers.list(query as WorkerFilters)); }
  @Get('workers/:id') async detail(@Param('id') id: string, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.workers.detail(id)); response.header('ETag', etag(result.version)); return result; }
  @Post('workers') create(@Body() body: CreateWorkerDto, @Headers('idempotency-key') key: string | undefined) { return this.run(() => this.workers.create(body, requiredKey(key))); }
  @Post('workers/:id/enrollment-token') @HttpCode(200) issue(@Param('id') id: string, @Headers('if-match') match: string | undefined, @Headers('idempotency-key') key: string | undefined) { return this.run(() => this.workers.issueToken(id, version(match), requiredKey(key))); }
  @Post('workers/:id/drain') @HttpCode(200) actionDrain(@Param('id') id: string, @Headers('if-match') match: string | undefined, @Headers('idempotency-key') key: string | undefined) { return this.run(() => this.workers.drain(id, version(match), requiredKey(key))); }
  @Post('workers/:id/revoke') @HttpCode(200) actionRevoke(@Param('id') id: string, @Headers('if-match') match: string | undefined, @Headers('idempotency-key') key: string | undefined) { return this.run(() => this.workers.revoke(id, version(match), requiredKey(key))); }
  @Post('workers/:id/confirm-termination') @HttpCode(200) confirm(@Param('id') id: string, @Headers('if-match') match: string | undefined, @Headers('idempotency-key') key: string | undefined) { return this.run(() => this.workers.confirmTermination(id, version(match), requiredKey(key))); }
  @Get('worker-images') images() { return this.run(() => this.workers.images()); }
  @Post('worker-images') createImage(@Body() body: CreateImageDto, @Headers('idempotency-key') key: string | undefined) { return this.run(() => this.workers.createImage(body, requiredKey(key))); }
  @Post('worker-images/:id/revoke') revokeImage(@Param('id') id: string, @Headers('if-match') match: string | undefined, @Headers('idempotency-key') key: string | undefined) { return this.run(() => this.workers.revokeImage(id, version(match), requiredKey(key))); }
  @Sse('worker-events') events() { return this.workers.events(); }
  private async run<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch (error) { map(error); } }
}
function map(error: unknown): never { if (!(error instanceof WorkerError)) throw error; const status = error.code === 'WORKER_NOT_FOUND' ? 404 : error.code === 'VERSION_CONFLICT' ? 412 : error.code.includes('TOKEN_INVALID') || error.code === 'WORKER_CREDENTIAL_REVOKED' ? 401 : ['WORKER_VALIDATION_FAILED'].includes(error.code) ? 400 : 409; throw new ProblemDetailsException(status, error.code, error.message); }
function version(value?: string) { const match = /^"([1-9]\d*)"$/u.exec(value ?? ''); if (!match) throw new BadRequestException('If-Match must be a strong numeric ETag'); return Number(match[1]); }
function requiredKey(value?: string) { if (!value) throw new BadRequestException('Idempotency-Key is required'); return value; }
function etag(value: number) { return `"${value}"`; }
