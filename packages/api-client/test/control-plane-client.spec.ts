import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createClient,
  getLiveness,
  getReadiness,
  type ProblemDetails,
  type SuccessEnvelope,
} from '../src';
import clientPackage from '../package.json';

describe('Control Plane client public API', () => {
  it('publishes the complete generated health client boundary', () => {
    expect(createClient).toBeTypeOf('function');
    expect(getLiveness).toBeTypeOf('function');
    expect(getReadiness).toBeTypeOf('function');
    expectTypeOf<SuccessEnvelope>().toHaveProperty('meta');
    expectTypeOf<ProblemDetails>().toHaveProperty('requestId');
  });

  it('does not expose internal deep-import paths', () => {
    expect(Object.keys(clientPackage.exports)).toEqual(['.']);
  });
});
