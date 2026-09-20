import { Body, Controller, Headers, Inject, Param, Post } from '@nestjs/common';
import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { WorkersService } from '../../application/workers.service';
import { WorkerError } from '../../domain/worker-errors';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EnrollmentDto, HeartbeatDto } from '../workers.dto';

@Controller('worker/v1')
export class WorkerAgentController {
  constructor(@Inject(WorkersService) private readonly workers: WorkersService) {}
  @Post('enroll') enroll(@Headers('authorization') auth: string | undefined, @Body() body: EnrollmentDto) { return this.run(() => this.workers.enroll(bearer(auth), body)); }
  @Post('sessions') session(@Headers('authorization') auth: string | undefined, @Body() body: EnrollmentDto) { return this.run(() => this.workers.startSession(bearer(auth), body)); }
  @Post('sessions/:id/heartbeat') heartbeat(@Headers('authorization') auth: string | undefined, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @Body() body: HeartbeatDto) { requiredKey(key); return this.run(() => this.workers.heartbeat(bearer(auth), id, body)); }
  private async run<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch (error) { if (!(error instanceof WorkerError)) throw error; const status = ['ENROLLMENT_TOKEN_INVALID', 'WORKER_CREDENTIAL_REVOKED'].includes(error.code) ? 401 : error.code === 'WORKER_VALIDATION_FAILED' ? 400 : 409; throw new ProblemDetailsException(status, error.code, error.message); } }
}
function bearer(value?: string) { const match = /^Bearer ([A-Za-z0-9_-]{20,})$/u.exec(value ?? ''); if (!match) throw new ProblemDetailsException(401, 'WORKER_CREDENTIAL_REVOKED', 'Worker credential is invalid'); return match[1]!; }
function requiredKey(value?: string) { if (!value || !/^[\x21-\x7e]{8,128}$/u.test(value)) throw new ProblemDetailsException(400, 'WORKER_VALIDATION_FAILED', 'Idempotency-Key is required'); }
