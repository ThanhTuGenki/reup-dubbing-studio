import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { RootErrorBoundary } from './root-error-boundary';

function Broken(): never { throw new Error('sensitive internal detail'); }
describe('RootErrorBoundary', () => {
  it('renders a safe readable fallback with reload action', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<RootErrorBoundary><Broken /></RootErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('Ứng dụng chưa thể hiển thị');
    expect(screen.getByRole('button', { name: 'Tải lại trang' })).toBeInTheDocument();
    expect(screen.queryByText('sensitive internal detail')).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
