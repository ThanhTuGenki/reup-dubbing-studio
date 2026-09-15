import { describe, expect, it } from 'vitest';
import styles from './globals.css?raw';

describe('global accessibility styles', () => {
  it('defines visible focus, touch targets, and reduced motion', () => {
    expect(styles).toContain(':focus-visible');
    expect(styles).toContain('min-height: 44px');
    expect(styles).toContain('prefers-reduced-motion: reduce');
  });
});
