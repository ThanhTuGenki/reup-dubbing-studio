import { BadRequestException, Body, Controller, Headers, HttpCode, Inject, Param, Patch, Post, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { StudioService } from '../../application/studio.service';
import { StudioError } from '../../domain/studio-errors';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StudioReviewDto, StudioSegmentPatchDto } from './studio.dto';
@Controller('v1/videos/:videoId')
export class StudioController {
  constructor(@Inject(StudioService) private readonly studio: StudioService) {}
  @Get('studio') async detail(@Param('videoId') id: string, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.studio.detail(id)); response.header('ETag', `"${result.video.version}"`); return result; }
  @Patch('segments/:segmentId') edit(@Param('videoId') videoId: string, @Param('segmentId') segmentId: string, @Headers('if-match') match: string | undefined, @Body() body: StudioSegmentPatchDto, @Headers('idempotency-key') _key?: string) { return this.run(() => this.studio.edit(videoId, segmentId, version(match), body)); }
  @Post('segments/:segmentId/preview') @HttpCode(200) preview(@Param('videoId') videoId: string, @Param('segmentId') segmentId: string) { return this.run(() => this.studio.preview(videoId, segmentId)); }
  @Post('segments/:segmentId/regenerate') @HttpCode(202) regenerate(@Param('videoId') videoId: string, @Param('segmentId') segmentId: string, @Headers('if-match') match: string | undefined, @Headers('idempotency-key') key: string | undefined) { return this.run(() => this.studio.regenerate(videoId, segmentId, version(match), requiredKey(key))); }
  @Post('review-decisions') review(@Param('videoId') videoId: string, @Headers('if-match') match: string | undefined, @Body() body: StudioReviewDto) { return this.run(() => this.studio.review(videoId, version(match), body)); }
  @Post('render-requests') @HttpCode(202) render(@Param('videoId') videoId: string, @Headers('if-match') match: string | undefined, @Headers('idempotency-key') key: string | undefined) { return this.run(() => this.studio.render(videoId, version(match), requiredKey(key))); }
  private async run<T>(action: () => Promise<T>) { try { return await action(); } catch (error) { if (!(error instanceof StudioError)) throw error; const status = error.code === 'VIDEO_NOT_FOUND' || error.code === 'SEGMENT_NOT_FOUND' ? 404 : error.code === 'VERSION_CONFLICT' ? 412 : error.code === 'PREVIEW_NOT_AVAILABLE' ? 409 : 400; throw new ProblemDetailsException(status, error.code, error.message); } }
}
function version(value?: string) { const match = /^"([1-9]\d*)"$/u.exec(value ?? ''); if (!match) throw new BadRequestException('If-Match must be a strong numeric ETag'); return Number(match[1]); }
function requiredKey(value?: string) { if (!value) throw new BadRequestException('Idempotency-Key is required'); return value; }
