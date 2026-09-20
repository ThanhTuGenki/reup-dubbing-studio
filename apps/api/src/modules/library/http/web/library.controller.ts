import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { LibraryService } from '../../application/library.service';
import { LibraryError } from '../../domain/library-errors';
import type { AssetPart, LibraryFilters } from '../../domain/library';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { LibraryGrantDto, LibraryListQueryDto } from './library.dto';
@Controller('v1/videos')
export class LibraryController {
  constructor(@Inject(LibraryService) private readonly library: LibraryService) {}
  @Get() list(@Query() query: LibraryListQueryDto) { return this.run(() => this.library.list(query as LibraryFilters)); }
  @Get(':videoId') async detail(@Param('videoId') id: string, @Res({ passthrough: true }) response: FastifyReply) { const result = await this.run(() => this.library.detail(id)); response.header('ETag', `"${result.version}"`); return result; }
  @Post(':videoId/assets/:linkId/grant') @HttpCode(200) grantAsset(@Param('videoId') videoId: string, @Param('linkId') linkId: string, @Body() body: LibraryGrantDto) { return this.run(() => this.library.grantAsset(videoId, linkId, body.purpose ?? 'download')); }
  @Post(':videoId/outputs/:outputId/:part/grant') @HttpCode(200) grantOutput(@Param('videoId') videoId: string, @Param('outputId') outputId: string, @Param('part') part: AssetPart, @Body() body: LibraryGrantDto) { if (!['video','subtitle','thumbnail'].includes(part)) throw new ProblemDetailsException(400, 'LIBRARY_PART_INVALID', 'Output part is invalid'); return this.run(() => this.library.grantOutput(videoId, outputId, part, body.purpose ?? 'download')); }
  private async run<T>(action: () => Promise<T>) { try { return await action(); } catch (error) { if (!(error instanceof LibraryError)) throw error; throw new ProblemDetailsException(error.code === 'VIDEO_NOT_FOUND' ? 404 : error.code === 'LIBRARY_ASSET_NOT_AVAILABLE' ? 409 : 400, error.code, error.message); } }
}
