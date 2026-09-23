import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/test-utils';
import { AppShell } from './app-shell';

describe('AppShell', () => {
  it('provides the shared navigation, route context, main landmark, and skip link', async () => {
    window.innerWidth = 1440;
    renderApp(<Routes><Route element={<AppShell />}><Route index element={<h1>Nền tảng</h1>} /></Route></Routes>);
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('link', { name: 'Đi đến nội dung chính' })).toHaveAttribute('href', '#main-content');
    expect(screen.getAllByRole('link', { current: 'page' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Breadcrumb')).toHaveTextContent('Tổng quan');
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' }).querySelectorAll('a')).toHaveLength(9);
    await waitFor(() => expect(document.title).toBe('Reup Dubbing Studio — Tổng quan'));
  });

  it('opens the command palette from the keyboard and navigates by Vietnamese or technical keywords', async () => {
    const user = userEvent.setup();
    renderApp(<Routes><Route element={<AppShell />}><Route index element={<h1>Nền tảng</h1>} /><Route path="queue" element={<h1>Queue destination</h1>} /></Route></Routes>);
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Tìm màn hình và thao tác' });
    await user.type(screen.getByPlaceholderText('Nhập tên màn hình…'), 'job');
    await user.click(screen.getByRole('option', { name: /Hàng đợi xử lý/ }));
    expect(dialog).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Queue destination' })).toBeInTheDocument();
  });
});
