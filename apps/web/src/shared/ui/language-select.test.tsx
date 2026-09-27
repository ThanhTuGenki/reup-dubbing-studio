import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/test-utils';
import { LanguageSelect } from './language-select';

describe('LanguageSelect', () => {
  it('lists languages by name, defaulting to the given codes in order', () => {
    renderApp(<LanguageSelect id="lang" value="zh" codes={['zh', 'en', 'ja']} onChange={vi.fn()} />);
    const select = screen.getByRole('combobox');
    expect(select).toHaveDisplayValue('Tiếng Trung');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Tiếng Trung', 'Tiếng Anh', 'Tiếng Nhật']);
  });

  it('lists every known language when no codes are given', () => {
    renderApp(<LanguageSelect id="lang" value="vi" onChange={vi.fn()} />);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Tiếng Việt', 'Tiếng Trung', 'Tiếng Anh', 'Tiếng Nhật', 'Tiếng Hàn', 'Tiếng Thái']);
  });

  it('preserves and keeps selected an unknown existing value', () => {
    renderApp(<LanguageSelect id="lang" value="vi-VN" onChange={vi.fn()} />);
    const select = screen.getByRole('combobox');
    expect(select).toHaveDisplayValue('Khác (vi-VN)');
    expect(screen.getByRole('option', { name: 'Khác (vi-VN)' })).toBeInTheDocument();
  });

  it('adds an allowAll option that reports an empty value', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState('vi');
      return <LanguageSelect id="lang" value={value} allowAll onChange={setValue} />;
    }
    renderApp(<Harness />);
    const select = screen.getByRole('combobox');
    expect(screen.getByRole('option', { name: 'Tất cả ngôn ngữ' })).toBeInTheDocument();
    await user.selectOptions(select, 'Tất cả ngôn ngữ');
    expect(select).toHaveDisplayValue('Tất cả ngôn ngữ');
  });

  it('sends the code of the picked name', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderApp(<LanguageSelect id="lang" value="vi" codes={['vi', 'en']} onChange={onChange} />);
    await user.selectOptions(screen.getByRole('combobox'), 'Tiếng Anh');
    expect(onChange).toHaveBeenCalledWith('en');
  });
});
