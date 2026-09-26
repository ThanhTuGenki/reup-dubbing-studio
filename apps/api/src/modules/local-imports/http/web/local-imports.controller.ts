import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import type { LocalVideoUploadRequest } from '@reup-dubbing-studio/api-contract';

import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { ProfileError } from '../../../profiles/domain/profile-errors';
import { LocalImportsService } from '../../application/local-imports.service';
import { LocalImportError } from '../../domain/local-import-errors';
// Runtime import is required for Nest validation metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { LocalVideoUploadDto } from './local-imports.dto';

@Controller('v1/local-imports')
export class LocalImportsController {
  constructor(@Inject(LocalImportsService) private readonly imports: LocalImportsService) {}

  @Post('uploads')
  requestUpload(@Body() body: LocalVideoUploadDto, @Headers('idempotency-key') key: string | undefined) {
    return this.run(() => this.imports.requestUpload(body as LocalVideoUploadRequest, idempotencyKey(key)));
  }

  @Post('uploads/:assetId/grant') @HttpCode(HttpStatus.OK)
  refresh(@Param('assetId') assetId: string) {
    return this.run(() => this.imports.refresh(uuidV7(assetId)));
  }

  @Post('uploads/:assetId/commit')
  commit(@Param('assetId') assetId: string, @Headers('idempotency-key') key: string | undefined) {
    return this.run(() => this.imports.commit(uuidV7(assetId), idempotencyKey(key)));
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) { throw map(error); }
  }
}

function uuidV7(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new BadRequestException('Asset ID must be a UUID v7');
  }
  return value;
}

function idempotencyKey(value: string | undefined): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new BadRequestException('Idempotency-Key must be a UUID');
  }
  return value;
}

function map(error: unknown): unknown {
  if (error instanceof ProfileError) {
    return new ProblemDetailsException(HttpStatus.CONFLICT, error.code, error.message);
  }
  if (!(error instanceof LocalImportError)) return error;
  const status = error.code === 'LOCAL_IMPORT_NOT_FOUND' ? HttpStatus.NOT_FOUND
    : error.code === 'LOCAL_IMPORT_VALIDATION_FAILED' ? HttpStatus.UNPROCESSABLE_ENTITY
      : error.code === 'LOCAL_IMPORT_NOT_AVAILABLE' ? HttpStatus.CONFLICT
        : HttpStatus.CONFLICT;
  return new ProblemDetailsException(status, error.code, error.message);
}
