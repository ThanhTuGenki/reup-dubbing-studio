import { BadRequestException, Body, Controller, Get, Headers, HttpStatus, Inject, Param, Patch, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { UpdateChannelReviewPolicy, UpdateSeriesReviewPolicy } from '@reup-dubbing-studio/api-contract';

import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { ReviewPolicyService } from '../../application/review-policy.service';
import { ReviewPolicyError } from '../../domain/review-policy-errors';
// Runtime DTO imports are required by emitDecoratorMetadata and the global validation pipe.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UpdateChannelReviewPolicyDto, UpdateSeriesReviewPolicyDto } from './review-policy.dto';

@Controller('v1')
export class ReviewPolicyController {
  constructor(@Inject(ReviewPolicyService) private readonly policies: ReviewPolicyService) {}

  @Get('channel-profiles/:id/review-policy')
  async getChannel(@Param('id') id: string, @Res({ passthrough: true }) response: FastifyReply) {
    const result = await this.run(() => this.policies.getChannel(profileId(id)));
    response.header('ETag', `"${result.version}"`);
    return result;
  }

  @Patch('channel-profiles/:id/review-policy')
  async updateChannel(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: UpdateChannelReviewPolicyDto,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.run(() => this.policies.updateChannel(
      profileId(id), channelVersion(ifMatch), body as UpdateChannelReviewPolicy, idempotencyKey(key),
    ));
    response.header('ETag', `"${result.version}"`);
    return result;
  }

  @Get('series-profiles/:id/review-policy')
  async getSeries(@Param('id') id: string, @Res({ passthrough: true }) response: FastifyReply) {
    const result = await this.run(() => this.policies.getSeries(profileId(id)));
    response.header('ETag', `"${result.version}:${result.parentPolicyVersion}"`);
    return result;
  }

  @Patch('series-profiles/:id/review-policy')
  async updateSeries(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: UpdateSeriesReviewPolicyDto,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const [version, parentVersion] = seriesVersion(ifMatch);
    const result = await this.run(() => this.policies.updateSeries(
      profileId(id), version, parentVersion, body as UpdateSeriesReviewPolicy, idempotencyKey(key),
    ));
    response.header('ETag', `"${result.version}:${result.parentPolicyVersion}"`);
    return result;
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) {
      if (!(error instanceof ReviewPolicyError)) throw error;
      const status = error.code === 'REVIEW_POLICY_NOT_FOUND' ? HttpStatus.NOT_FOUND
        : error.code === 'VERSION_CONFLICT' ? HttpStatus.PRECONDITION_FAILED
          : error.code === 'IDEMPOTENCY_KEY_REUSED' ? HttpStatus.CONFLICT
            : HttpStatus.UNPROCESSABLE_ENTITY;
      throw new ProblemDetailsException(status, error.code, error.message);
    }
  }
}

function profileId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new BadRequestException('Profile ID must be a UUID v7');
  return value;
}
function idempotencyKey(value: string | undefined): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new BadRequestException('Idempotency-Key must be a UUID');
  return value;
}
function channelVersion(value: string | undefined): number {
  const match = /^"([1-9]\d*)"$/u.exec(value ?? '');
  if (!match) throw new BadRequestException('If-Match must contain a strong review policy ETag');
  return Number(match[1]);
}
function seriesVersion(value: string | undefined): [number, number] {
  const match = /^"([1-9]\d*):([1-9]\d*)"$/u.exec(value ?? '');
  if (!match) throw new BadRequestException('If-Match must contain a strong effective review policy ETag');
  return [Number(match[1]), Number(match[2])];
}
