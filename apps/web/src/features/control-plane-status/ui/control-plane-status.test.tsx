import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  CONTROL_PLANE_BASE_URL,
  createProblemDetails,
  readyEnvelope,
  READINESS_PATH,
  READY_REQUEST_ID,
} from '../../../test/fixtures/control-plane';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/test-utils';
import { ControlPlaneStatus } from './control-plane-status';

describe('ControlPlaneStatus', () => {
  it('moves from loading to ready and shows the support ID', async () => {
    renderApp(<ControlPlaneStatus />);
    expect(screen.getByText('Đang kiểm tra')).toBeInTheDocument();
    expect(await screen.findByText('Sẵn sàng')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(READY_REQUEST_ID))).toBeInTheDocument();
  });
  it('shows a safe error and manually retries', async () => {
    let attempts = 0;
    server.use(http.get(`${CONTROL_PLANE_BASE_URL}${READINESS_PATH}`, () => {
      attempts += 1;
      return attempts === 1
        ? HttpResponse.json(createProblemDetails({ title: 'raw secret' }), { status: 503 })
        : HttpResponse.json(readyEnvelope);
    }));
    renderApp(<ControlPlaneStatus />);
    expect(await screen.findByText('Cần kiểm tra')).toBeInTheDocument();
    expect(screen.queryByText('raw secret')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Sẵn sàng')).toBeInTheDocument();
    expect(attempts).toBe(2);
  });
});
