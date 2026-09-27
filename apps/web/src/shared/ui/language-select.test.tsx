import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/test-utils';
import { LanguageSelect } from './language-select';

describe('LanguageSelect', () => {
  it('lists languages by name, defaulting to the given codes in order', async () => {
    const user = userEvent.setup();
    renderApp(<LanguageSelect id="lang" value="zh" codes={['zh', 'en', 'ja']} onChange={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Tiếng Trung');
    await user.click(trigger);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Tiếng Trung', 'Tiếng Anh', 'Tiếng Nhật']);
  });

  it('lists every known language when no codes are given', async () => {
    const user = userEvent.setup();
    renderApp(<LanguageSelect id="lang" value="vi" onChange={vi.fn()} />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Tiếng Việt', 'Tiếng Trung', 'Tiếng Anh', 'Tiếng Nhật', 'Tiếng Hàn', 'Tiếng Thái']);
  });

  it('preserves and keeps selected an unknown existing value', async () => {
    const user = userEvent.setup();
    renderApp(<LanguageSelect id="lang" value="vi-VN" onChange={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Khác (vi-VN)');
    await user.click(trigger);
    expect(screen.getByRole('option', { name: 'Khác (vi-VN)' })).toBeInTheDocument();
  });

  it('adds an allowAll option that reports an empty value', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState('vi');
      return <LanguageSelect id="lang" value={value} allowAll onChange={setValue} />;
    }
    renderApp(<Harness />);
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    expect(screen.getByRole('option', { name: 'Tất cả ngôn ngữ' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Tất cả ngôn ngữ' }));
    expect(trigger).toHaveTextContent('Tất cả ngôn ngữ');
  });

  it('sends the code of the picked name', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderApp(<LanguageSelect id="lang" value="vi" codes={['vi', 'en']} onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Tiếng Anh' }));
    expect(onChange).toHaveBeenCalledWith('en');
  });
});
