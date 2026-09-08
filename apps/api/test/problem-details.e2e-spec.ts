import {
  Controller,
  Get,
  Injectable,
  Module,
  type LoggerService,
  NestModule,
  MiddlewareConsumer,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import Ajv from 'ajv';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');

import { RequestContextMiddleware } from '../src/common/context/request-context.middleware';
import { NotFoundError } from '../src/common/errors';
import { ProblemDetailsFilter } from '../src/common/problem-details.filter';

@Controller('__test')
class ProblemController {
  @Get('not-found') notFound(): never {
    throw new NotFoundError('NOT_FOUND');
  }
  @Get('boom') boom(): never {
    throw new Error('db password is x');
  }
  @Get('prisma') prisma(): never {
    throw { code: 'P2002' };
  }
}

@Injectable()
class TestLogger implements LoggerService {
  readonly errors: unknown[] = [];
  error(message: unknown): void {
    this.errors.push(message);
  }
  warn(): void {}
  log(): void {}
}

@Module({ controllers: [ProblemController], providers: [TestLogger] })
class ProblemTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

const problemDetailsSchema = {
  type: 'object',
  required: ['type', 'title', 'status', 'detail', 'instance', 'code', 'requestId'],
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer', minimum: 400, maximum: 599 },
    detail: { type: 'string' },
    instance: { type: 'string' },
    code: {
      enum: [
        'VALIDATION_ERROR',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'NOT_FOUND',
        'VERSION_CONFLICT',
        'UNPROCESSABLE_ENTITY',
        'UPSTREAM_UNAVAILABLE',
        'INTERNAL_ERROR',
      ],
    },
    requestId: { type: 'string' },
  },
};

describe('Problem Details filter (E2E)', () => {
  let app: NestFastifyApplication;
  let logger: TestLogger;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProblemTestModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    logger = app.get(TestLogger);
    app.useGlobalFilters(new ProblemDetailsFilter(logger));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app.close());

  it('returns contract-shaped NOT_FOUND with request id and problem content type', async () => {
    const response = await request(app.getHttpServer())
      .get('/__test/not-found')
      .set('x-request-id', 'request-12');
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(response.body.requestId).toBe('request-12');
    expect(new Ajv().compile(problemDetailsSchema)(response.body)).toBe(true);
  });

  it('hides unknown error detail and logs its stack', async () => {
    const response = await request(app.getHttpServer()).get('/__test/boom');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('db password');
    expect(logger.errors[0]).toBeInstanceOf(Error);
    expect(String((logger.errors[0] as Error).stack)).toContain('db password is x');
  });

  it('maps Prisma unique constraint errors to conflict', async () => {
    const response = await request(app.getHttpServer()).get('/__test/prisma');
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('VERSION_CONFLICT');
  });
});
