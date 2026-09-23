import type { PrismaDashboardRepository } from '../infrastructure/prisma-dashboard-repository';

export class DashboardService {
  constructor(private readonly repository: PrismaDashboardRepository) {}
  get() { return this.repository.get(); }
}
