import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { DiscoveryService } from '../../application/discovery.service';
import type { CreateRun, CreateSourceAccount, CreateWatchlist, DiscoveryItemQuery, UpdateWatchlist } from '../../domain/discovery';
import { DiscoveryError } from '../../domain/discovery-errors';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CategoryQueryDto, CreateDiscoveryRunDto, CreateSourceAccountDto, CreateWatchlistDto, DiscoveryItemsQueryDto, ImportSourceCredentialDto, SourceAccountQueryDto, UpdateWatchlistDto } from './discovery.dto';

@Controller('v1')
export class DiscoveryController {
  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}

  @Post('source-accounts') async createAccount(@Headers('idempotency-key') key: string | undefined, @Body() body: CreateSourceAccountDto, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.discovery.createAccount(body as CreateSourceAccount, requestKey(key))); response.header('ETag', etag(result.version)); return result; }
  @Get('source-accounts') listAccounts(@Query() query: SourceAccountQueryDto) { return this.run(() => this.discovery.listAccounts(query.platform)); }
  @Post('source-accounts/:id/credentials') @HttpCode(HttpStatus.OK) async importCredential(@Param('id') id: string, @Body() body: ImportSourceCredentialDto, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.discovery.importCredential(uuid(id), body.netscapeCookie)); response.header('ETag', etag(result.version)); return result; }
  @Post('source-accounts/:id/validate') @HttpCode(HttpStatus.OK) async validateAccount(@Param('id') id: string, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.discovery.validateAccount(uuid(id))); response.header('ETag', etag(result.version)); return result; }
  @Delete('source-accounts/:id/credentials/current') async revokeCredential(@Param('id') id: string, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.discovery.revokeCredential(uuid(id))); response.header('ETag', etag(result.version)); return result; }

  @Get('discovery/categories') categories(@Query() query: CategoryQueryDto) { return this.run(() => this.discovery.listCategories(query.platform)); }
  @Post('discovery/runs') @HttpCode(HttpStatus.ACCEPTED) async createRun(@Headers('idempotency-key') key: string | undefined, @Body() body: CreateDiscoveryRunDto, @Res({ passthrough: true }) response: FastifyReply) { const input = { ...body, sourceAccountId: uuid(body.sourceAccountId), ...(body.categoryId ? { categoryId: uuid(body.categoryId) } : {}) } as CreateRun; const result = await this.run(() => this.discovery.createRun(input, requestKey(key))); response.header('ETag', etag(result.version)); return result; }
  @Get('discovery/runs/:id') async getRun(@Param('id') id: string, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.discovery.getRun(uuid(id))); response.header('ETag', etag(result.version)); return result; }
  @Post('discovery/runs/:id/cancel') @HttpCode(HttpStatus.OK) async cancelRun(@Param('id') id: string, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.discovery.cancelRun(uuid(id))); response.header('ETag', etag(result.version)); return result; }
  @Get('discovery/items') listItems(@Query() query: DiscoveryItemsQueryDto) { return this.run(() => this.discovery.listItems(validateItemIds(query) as DiscoveryItemQuery)); }

  @Post('watchlists') async createWatchlist(@Headers('idempotency-key') key: string | undefined, @Body() body: CreateWatchlistDto, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.discovery.createWatchlist({ ...body, sourceAccountId: uuid(body.sourceAccountId) } as CreateWatchlist, requestKey(key))); response.header('ETag', etag(result.version)); return result; }
  @Get('watchlists') listWatchlists() { return this.run(() => this.discovery.listWatchlists()); }
  @Patch('watchlists/:id') async updateWatchlist(@Param('id') id: string, @Headers('if-match') match: string | undefined, @Body() body: UpdateWatchlistDto, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.discovery.updateWatchlist(uuid(id), version(match), body as UpdateWatchlist)); response.header('ETag', etag(result.version)); return result; }
  @Post('watchlists/:id/run') @HttpCode(HttpStatus.ACCEPTED) async runWatchlist(@Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.discovery.runWatchlist(uuid(id), requestKey(key))); response.header('ETag', etag(result.version)); return result; }
  @Delete('watchlists/:id') deleteWatchlist(@Param('id') id: string, @Headers('if-match') match: string | undefined) { return this.run(() => this.discovery.deleteWatchlist(uuid(id), version(match))); }

  private async run<T>(action: () => Promise<T>) { try { return await action(); } catch (error) { throw map(error); } }
}

function validateItemIds(query: DiscoveryItemsQueryDto) { return { ...query, ...(query.runId ? { runId: uuid(query.runId) } : {}), ...(query.categoryId ? { categoryId: uuid(query.categoryId) } : {}), ...(query.creatorId ? { creatorId: uuid(query.creatorId) } : {}) }; }
function uuid(value: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new BadRequestException('ID must be a UUID v7'); return value; }
function requestKey(value: string | undefined) { if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new BadRequestException('Idempotency-Key must be a UUID'); return value; }
function version(value: string | undefined) { const match = /^"([1-9]\d*)"$/u.exec(value ?? ''); if (!match) throw new BadRequestException('If-Match must contain a strong watchlist ETag'); return Number(match[1]); }
function etag(value: number) { return `"${value}"`; }
function map(error: unknown) { if (!(error instanceof DiscoveryError)) return error; const status = error.code.endsWith('NOT_FOUND') ? 404 : error.code.includes('VALIDATION') || error.code.includes('CURSOR') ? 422 : error.code === 'DISCOVERY_PROVIDER_UNAVAILABLE' ? 503 : error.code === 'SOURCE_ACCOUNT_CREDENTIAL_REQUIRED' ? 409 : 409; return new ProblemDetailsException(status, error.code, error.message); }
