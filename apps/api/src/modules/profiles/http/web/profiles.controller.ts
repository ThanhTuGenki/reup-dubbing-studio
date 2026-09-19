import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { ProfilesService } from '../../application/profiles.service';
import { ProfileAssetsService } from '../../application/profile-assets.service';
import { ProfileError } from '../../domain/profile-errors';
import type { CreateChannelProfile, CreateSeriesProfile, UpdateChannelProfile, UpdateSeriesProfile } from '../../domain/profiles';
import type { RequestProfileUpload } from '../../domain/profile-assets';
// Runtime DTO imports are required by emitDecoratorMetadata and the global validation pipe.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateChannelProfileDto, CreateSeriesProfileDto, ProfileListQueryDto, RequestProfileUploadDto, UpdateChannelProfileDto, UpdateSeriesProfileDto } from './profiles.dto';

@Controller('v1')
export class ProfilesController {
  constructor(
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
    @Inject(ProfileAssetsService) private readonly assets: ProfileAssetsService,
  ) {}

  @Get('channel-profiles')
  listChannels(@Query() query: ProfileListQueryDto) {
    return this.run(() => this.profiles.listChannels(query));
  }

  @Post('channel-profiles')
  async createChannel(
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateChannelProfileDto,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.run(() => this.profiles.createChannel(body as CreateChannelProfile, idempotencyKey(key)));
    response.header('ETag', channelEtag(result.version));
    return result;
  }

  @Get('channel-profiles/:id')
  async getChannel(@Param('id') id: string, @Res({ passthrough: true }) response: FastifyReply) {
    const result = await this.run(() => this.profiles.getChannel(profileId(id)));
    response.header('ETag', channelEtag(result.version));
    return result;
  }

  @Patch('channel-profiles/:id')
  async updateChannel(
    @Param('id') id: string, @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateChannelProfileDto, @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.run(() => this.profiles.updateChannel(profileId(id), channelVersion(ifMatch), body as UpdateChannelProfile));
    response.header('ETag', channelEtag(result.version));
    return result;
  }

  @Post('channel-profiles/:id/archive') @HttpCode(HttpStatus.OK)
  async archiveChannel(@Param('id') id: string, @Headers('if-match') ifMatch: string | undefined, @Res({ passthrough: true }) response: FastifyReply) {
    const result = await this.run(() => this.profiles.archiveChannel(profileId(id), channelVersion(ifMatch)));
    response.header('ETag', channelEtag(result.version));
    return result;
  }

  @Post('channel-profiles/:id/restore') @HttpCode(HttpStatus.OK)
  async restoreChannel(@Param('id') id: string, @Headers('if-match') ifMatch: string | undefined, @Res({ passthrough: true }) response: FastifyReply) {
    const result = await this.run(() => this.profiles.restoreChannel(profileId(id), channelVersion(ifMatch)));
    response.header('ETag', channelEtag(result.version));
    return result;
  }

  @Post('channel-profiles/:id/assets/uploads')
  requestChannelUpload(@Param('id') id: string, @Body() body: RequestProfileUploadDto) {
    return this.run(() => this.assets.requestUpload({ type: 'CHANNEL', id: profileId(id) }, body as RequestProfileUpload));
  }

  @Post('channel-profiles/:id/assets/uploads/:assetId/commit') @HttpCode(HttpStatus.OK)
  async commitChannelUpload(
    @Param('id') id: string, @Param('assetId') assetId: string,
    @Headers('if-match') ifMatch: string | undefined, @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.run(() => this.assets.commit(
      { type: 'CHANNEL', id: profileId(id) }, profileId(assetId), channelVersion(ifMatch), undefined, idempotencyKey(key),
    ));
    response.header('ETag', channelEtag(result.profileVersion));
    return result;
  }

  @Post('channel-profiles/:id/assets/uploads/:assetId/grant') @HttpCode(HttpStatus.OK)
  refreshChannelUpload(@Param('id') id: string, @Param('assetId') assetId: string) {
    return this.run(() => this.assets.refreshUpload({ type: 'CHANNEL', id: profileId(id) }, profileId(assetId)));
  }

  @Delete('channel-profiles/:id/assets/:linkId')
  async detachChannelAsset(
    @Param('id') id: string, @Param('linkId') linkId: string,
    @Headers('if-match') ifMatch: string | undefined, @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.run(() => this.assets.detach(
      { type: 'CHANNEL', id: profileId(id) }, profileId(linkId), channelVersion(ifMatch),
    ));
    response.header('ETag', channelEtag(result.profileVersion));
    return result;
  }

  @Get('channel-profiles/:id/assets/:linkId/preview')
  previewChannelAsset(@Param('id') id: string, @Param('linkId') linkId: string) {
    return this.run(() => this.assets.preview({ type: 'CHANNEL', id: profileId(id) }, profileId(linkId)));
  }

  @Get('series-profiles')
  listSeries(@Query() query: ProfileListQueryDto) {
    return this.run(() => this.profiles.listSeries(query));
  }

  @Post('series-profiles')
  async createSeries(
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateSeriesProfileDto,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.run(() => this.profiles.createSeries(body as CreateSeriesProfile, idempotencyKey(key)));
    response.header('ETag', seriesEtag(result.version, result.parentVersion));
    return result;
  }

  @Get('series-profiles/:id')
  async getSeries(@Param('id') id: string, @Res({ passthrough: true }) response: FastifyReply) {
    const result = await this.run(() => this.profiles.getSeries(profileId(id)));
    response.header('ETag', seriesEtag(result.version, result.parentVersion));
    return result;
  }

  @Patch('series-profiles/:id')
  async updateSeries(
    @Param('id') id: string, @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateSeriesProfileDto, @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const [version, parentVersion] = seriesVersion(ifMatch);
    const result = await this.run(() => this.profiles.updateSeries(profileId(id), version, parentVersion, body as UpdateSeriesProfile));
    response.header('ETag', seriesEtag(result.version, result.parentVersion));
    return result;
  }

  @Post('series-profiles/:id/archive') @HttpCode(HttpStatus.OK)
  async archiveSeries(@Param('id') id: string, @Headers('if-match') ifMatch: string | undefined, @Res({ passthrough: true }) response: FastifyReply) {
    const [version, parentVersion] = seriesVersion(ifMatch);
    const result = await this.run(() => this.profiles.archiveSeries(profileId(id), version, parentVersion));
    response.header('ETag', seriesEtag(result.version, result.parentVersion));
    return result;
  }

  @Post('series-profiles/:id/restore') @HttpCode(HttpStatus.OK)
  async restoreSeries(@Param('id') id: string, @Headers('if-match') ifMatch: string | undefined, @Res({ passthrough: true }) response: FastifyReply) {
    const [version, parentVersion] = seriesVersion(ifMatch);
    const result = await this.run(() => this.profiles.restoreSeries(profileId(id), version, parentVersion));
    response.header('ETag', seriesEtag(result.version, result.parentVersion));
    return result;
  }

  @Post('series-profiles/:id/assets/uploads')
  requestSeriesUpload(@Param('id') id: string, @Body() body: RequestProfileUploadDto) {
    return this.run(() => this.assets.requestUpload({ type: 'SERIES', id: profileId(id) }, body as RequestProfileUpload));
  }

  @Post('series-profiles/:id/assets/uploads/:assetId/commit') @HttpCode(HttpStatus.OK)
  async commitSeriesUpload(
    @Param('id') id: string, @Param('assetId') assetId: string,
    @Headers('if-match') ifMatch: string | undefined, @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const [version, parentVersion] = seriesVersion(ifMatch);
    const result = await this.run(() => this.assets.commit(
      { type: 'SERIES', id: profileId(id) }, profileId(assetId), version, parentVersion, idempotencyKey(key),
    ));
    response.header('ETag', seriesEtag(result.profileVersion, result.parentVersion!));
    return result;
  }

  @Post('series-profiles/:id/assets/uploads/:assetId/grant') @HttpCode(HttpStatus.OK)
  refreshSeriesUpload(@Param('id') id: string, @Param('assetId') assetId: string) {
    return this.run(() => this.assets.refreshUpload({ type: 'SERIES', id: profileId(id) }, profileId(assetId)));
  }

  @Delete('series-profiles/:id/assets/:linkId')
  async detachSeriesAsset(
    @Param('id') id: string, @Param('linkId') linkId: string,
    @Headers('if-match') ifMatch: string | undefined, @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const [version, parentVersion] = seriesVersion(ifMatch);
    const result = await this.run(() => this.assets.detach(
      { type: 'SERIES', id: profileId(id) }, profileId(linkId), version, parentVersion,
    ));
    response.header('ETag', seriesEtag(result.profileVersion, result.parentVersion!));
    return result;
  }

  @Get('series-profiles/:id/assets/:linkId/preview')
  previewSeriesAsset(@Param('id') id: string, @Param('linkId') linkId: string) {
    return this.run(() => this.assets.preview({ type: 'SERIES', id: profileId(id) }, profileId(linkId)));
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) { throw mapProfileError(error); }
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
  if (!match) throw new BadRequestException('If-Match must contain a strong channel profile ETag');
  return Number(match[1]);
}
function seriesVersion(value: string | undefined): [number, number] {
  const match = /^"([1-9]\d*):([1-9]\d*)"$/u.exec(value ?? '');
  if (!match) throw new BadRequestException('If-Match must contain a strong series effective ETag');
  return [Number(match[1]), Number(match[2])];
}
function channelEtag(version: number): string { return `"${version}"`; }
function seriesEtag(version: number, parentVersion: number): string { return `"${version}:${parentVersion}"`; }

function mapProfileError(error: unknown): unknown {
  if (!(error instanceof ProfileError)) return error;
  const status = error.code === 'PROFILE_NOT_FOUND' ? HttpStatus.NOT_FOUND
    : error.code === 'PROFILE_VALIDATION_FAILED' || error.code === 'PROFILE_MASK_INVALID'
      || error.code === 'PROFILE_ASSET_ROLE_INVALID'
      ? HttpStatus.UNPROCESSABLE_ENTITY
      : HttpStatus.CONFLICT;
  return new ProblemDetailsException(status, error.code, error.message);
}
