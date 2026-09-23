import { Controller, Get, Inject } from '@nestjs/common';
import { DashboardService } from '../../application/dashboard.service';

@Controller('v1/dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}
  @Get() get() { return this.dashboard.get(); }
}
