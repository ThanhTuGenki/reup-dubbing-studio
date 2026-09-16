import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderApp } from './test-utils';

describe('Web test runner', () => {
  it('renders a TypeScript React smoke surface', () => {
    renderApp(<p>Web foundation test runner</p>);
    expect(screen.getByText('Web foundation test runner')).toBeInTheDocument();
  });
});
