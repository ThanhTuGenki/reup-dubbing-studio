import { describe, expect, it } from 'vitest';
import tokens from './tokens.css?raw';

describe('OpenDesign theme adapter', () => {
  it('maps the canonical visual tokens to shadcn semantics', () => {
    expect(tokens).toContain('--canvas: #f5f8f4');
    expect(tokens).toContain('--surface-warm: #f2f7f2');
    expect(tokens).toContain('--fg: #1f2d22');
    expect(tokens).toContain('--brand-accent-strong: #397246');
    expect(tokens).toContain('--primary: var(--brand-accent-strong)');
    expect(tokens).toContain('--radius-control: 6px');
    expect(tokens).toContain('--radius-card: 12px');
    expect(tokens).toContain('--control-h: 44px');
    expect(tokens).toContain('--sidebar-w: 248px');
    expect(tokens).toContain('--topbar-h: 64px');
    expect(tokens).toContain('--motion-fast: 150ms');
    expect(tokens).toContain('--motion-base: 200ms');
  });
});
