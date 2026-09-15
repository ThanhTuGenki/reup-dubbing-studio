import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/test-utils';
import { AppShell } from './app-shell';

describe('AppShell', () => {
  it('provides named navigation, main landmark, skip link, and text active state', () => {
    renderApp(<Routes><Route element={<AppShell />}><Route index element={<h1>Nền tảng</h1>} /></Route></Routes>);
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('link', { name: 'Đi đến nội dung chính' })).toHaveAttribute('href', '#main-content');
    expect(screen.getByText('Hiện tại')).toBeInTheDocument();
  });
});
