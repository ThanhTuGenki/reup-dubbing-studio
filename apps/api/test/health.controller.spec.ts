import { ServiceUnavailableException } from '@nestjs/common';

import { HealthController } from '../src/health/health.controller';
import { PrismaService } from '../src/infra/prisma/prisma.service';

describe('HealthController', () => {
  it('keeps liveness independent from Prisma', () => {
    const queryRaw = jest.fn();
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const controller = new HealthController(prisma);

    expect(controller.health()).toEqual({ status: 'ok' });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('reports readiness unavailable when Postgres is down', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as PrismaService;
    const controller = new HealthController(prisma);

    await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reports readiness when Postgres responds', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as unknown as PrismaService;
    const controller = new HealthController(prisma);

    await expect(controller.readiness()).resolves.toEqual({ status: 'ok' });
  });
});
