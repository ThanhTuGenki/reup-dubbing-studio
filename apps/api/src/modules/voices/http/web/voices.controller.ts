import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { VoicesService } from '../../application/voices.service';
import { VoiceSamplesService } from '../../application/voice-samples.service';
import { VoiceError } from '../../domain/voice-errors';
import type { CreateVoiceProfile, RequestVoiceSampleUpload, UpdateVoiceProfile } from '../../domain/voices';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateVoiceDto, RequestVoiceSampleUploadDto, UpdateVoiceDto, VoiceListQueryDto } from './voices.dto';

@Controller('v1/voice-profiles')
export class VoicesController {
  constructor(@Inject(VoicesService) private readonly voices: VoicesService, @Inject(VoiceSamplesService) private readonly samples: VoiceSamplesService) {}
  @Get() list(@Query() query: VoiceListQueryDto) { return this.run(() => this.voices.list(query)); }
  @Post() async create(@Headers('idempotency-key') key: string | undefined, @Body() body: CreateVoiceDto, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.voices.create(body as CreateVoiceProfile, requestKey(key))); response.header('ETag', etag(result.version)); return result; }
  @Get(':id') async get(@Param('id') id: string, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.voices.get(uuid(id))); response.header('ETag', etag(result.version)); return result; }
  @Patch(':id') async update(@Param('id') id: string, @Headers('if-match') match: string | undefined, @Body() body: UpdateVoiceDto, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.voices.update(uuid(id), version(match), body as UpdateVoiceProfile)); response.header('ETag', etag(result.version)); return result; }
  @Post(':id/activate') @HttpCode(HttpStatus.OK) activate(@Param('id') id: string, @Headers('if-match') match: string | undefined, @Res({ passthrough: true }) response: FastifyReply) { return this.mutation(() => this.voices.activate(uuid(id), version(match)), response); }
  @Post(':id/archive') @HttpCode(HttpStatus.OK) archive(@Param('id') id: string, @Headers('if-match') match: string | undefined, @Res({ passthrough: true }) response: FastifyReply) { return this.mutation(() => this.voices.archive(uuid(id), version(match)), response); }
  @Post(':id/restore') @HttpCode(HttpStatus.OK) restore(@Param('id') id: string, @Headers('if-match') match: string | undefined, @Res({ passthrough: true }) response: FastifyReply) { return this.mutation(() => this.voices.restore(uuid(id), version(match)), response); }
  @Post(':id/samples/uploads') requestUpload(@Param('id') id: string, @Body() body: RequestVoiceSampleUploadDto) { return this.run(() => this.samples.requestUpload(uuid(id), body as RequestVoiceSampleUpload)); }
  @Post(':id/samples/uploads/:assetId/grant') @HttpCode(HttpStatus.OK) refresh(@Param('id') id: string, @Param('assetId') assetId: string) { return this.run(() => this.samples.refresh(uuid(id), uuid(assetId))); }
  @Post(':id/samples/uploads/:assetId/commit') @HttpCode(HttpStatus.OK) async commit(@Param('id') id: string, @Param('assetId') assetId: string, @Headers('if-match') match: string | undefined, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.samples.commit(uuid(id), uuid(assetId), version(match), requestKey(key))); response.header('ETag', etag(result.profileVersion)); return result; }
  @Get(':id/samples/:sampleId/preview') preview(@Param('id') id: string, @Param('sampleId') sampleId: string) { return this.run(() => this.samples.preview(uuid(id), uuid(sampleId))); }
  @Delete(':id/samples/:sampleId') async detach(@Param('id') id: string, @Param('sampleId') sampleId: string, @Headers('if-match') match: string | undefined, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.samples.detach(uuid(id), uuid(sampleId), version(match))); response.header('ETag', etag(result.profileVersion)); return result; }
  private async mutation(action: () => Promise<{ version: number }>, response: FastifyReply) { const result = await this.run(action); response.header('ETag', etag(result.version)); return result; }
  private async run<T>(action: () => Promise<T>) { try { return await action(); } catch (error) { throw map(error); } }
}
function uuid(value: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new BadRequestException('ID must be a UUID v7'); return value; }
function requestKey(value: string | undefined) { if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new BadRequestException('Idempotency-Key must be a UUID'); return value; }
function version(value: string | undefined) { const match = /^"([1-9]\d*)"$/u.exec(value ?? ''); if (!match) throw new BadRequestException('If-Match must contain a strong voice ETag'); return Number(match[1]); }
function etag(value: number) { return `"${value}"`; }
function map(error: unknown) { if (!(error instanceof VoiceError)) return error; const status = error.code === 'VOICE_NOT_FOUND' ? 404 : error.code === 'VOICE_VALIDATION_FAILED' ? 422 : 409; return new ProblemDetailsException(status, error.code, error.message); }
