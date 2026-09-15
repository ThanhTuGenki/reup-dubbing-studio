import { Controller, Get } from '@nestjs/common';

type HealthStatus = { status: 'ok' };

@Controller('v1/health')
export class HealthController {
  @Get('live')
  liveness(): HealthStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  readiness(): HealthStatus {
    // Configuration has already passed fail-fast validation before this controller exists.
    return { status: 'ok' };
  }
}
