import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { IngestService } from '../../application/ingest.service';
import { IngestError } from '../../domain/ingest-errors';
import type { IngestSelection } from '../../domain/ingest';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- decorators need the runtime DTO constructor
import { IngestSelectionDto } from './ingest.dto';

@Controller('v1')
export class IngestController {
  constructor(@Inject(IngestService) private readonly ingest: IngestService) {}

  @Post('ingest/preflight')
  @HttpCode(HttpStatus.OK)
  preflight(@Body() body: IngestSelectionDto) {
    return this.run(() => this.ingest.preflight(body as IngestSelection));
  }

  @Post('ingest/jobs')
  async create(
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: IngestSelectionDto,
    @Req() request: FastifyRequest & { requestId?: string },
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    if (!key) throw new BadRequestException('Idempotency-Key is required');
    const result = await this.run(() => this.ingest.create(body as IngestSelection, key, request.requestId));
    response.status(result.summary.created > 0 ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) {
      if (!(error instanceof IngestError)) throw error;
      const status = error.code === 'IDEMPOTENCY_KEY_REUSED' ? 409
        : error.code === 'INGEST_NO_CREATABLE_ITEMS' ? 422 : 400;
      throw new ProblemDetailsException(status, error.code, error.message);
    }
  }
}
