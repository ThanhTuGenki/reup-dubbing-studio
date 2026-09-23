import { describe, expect, it } from 'vitest';

import { toVietnamDateTimeInput, vietnamDateTimeInputToIso } from './display-time';

describe('Vietnam display time', () => {
  it('converts a UTC instant across the Vietnam day boundary independently of browser timezone', () => {
    expect(toVietnamDateTimeInput('2026-09-22T17:30:00.000Z')).toBe('2026-09-23T00:30');
  });

  it('converts a Vietnam wall-clock input back to the canonical UTC instant', () => {
    expect(vietnamDateTimeInputToIso('2026-09-23T00:30')).toBe('2026-09-22T17:30:00.000Z');
  });
});
