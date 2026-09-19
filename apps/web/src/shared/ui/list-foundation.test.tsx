import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { renderApp } from '../../test/test-utils';
import { ListFilterBar } from './list-filter-bar';
import { ListPagination } from './list-pagination';
import { ListState } from './list-state';

describe('shared list UI', () => {
  it('exposes a resettable filter composition', async () => {
    const onReset = vi.fn();
    const { rerender } = renderApp(
      <ListFilterBar title="Bộ lọc nguồn" description="Lọc metadata đã thu thập." isFiltered={false} onReset={onReset}>
        <Input aria-label="Tìm video" />
      </ListFilterBar>,
    );

    expect(screen.getByRole('button', { name: 'Đặt lại' })).toBeDisabled();

    rerender(
      <ListFilterBar title="Bộ lọc nguồn" description="Lọc metadata đã thu thập." isFiltered onReset={onReset}>
        <Input aria-label="Tìm video" />
      </ListFilterBar>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Đặt lại' }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it.each([
    ['loading', 'Đang tải danh sách'],
    ['empty', 'Chưa có video phù hợp'],
    ['error', 'Không thể tải danh sách'],
  ] as const)('renders an accessible %s state', (state, title) => {
    renderApp(
      <ListState
        state={state}
        title={title}
        description="Hãy thử lại sau."
        action={state === 'error' ? <Button>Thử lại</Button> : undefined}
      />,
    );

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByRole(state === 'error' ? 'alert' : 'status')).toBeInTheDocument();
  });

  it('changes page and resets to page one when page size changes', async () => {
    const onChange = vi.fn();
    renderApp(
      <ListPagination page={2} pageSize={20} totalItems={126} itemLabel="video" onChange={onChange} />,
    );

    expect(screen.getByText('Hiển thị 21–40 trong 126 video')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(onChange).toHaveBeenLastCalledWith({ page: 3, pageSize: 20 });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Số hàng mỗi trang' }), '50');
    expect(onChange).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 });
  });
});
