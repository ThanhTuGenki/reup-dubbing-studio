import { useQuery } from '@tanstack/react-query';
import { ControlPlaneError } from '../../../shared/api/control-plane';
import { RuntimeConfigError } from '../../../shared/config/runtime-config';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { readinessQuery } from '../api/readiness-query';
import type { ConnectionStatus } from '../model/connection-status';

function toStatus(isPending: boolean, data: { requestId: string } | undefined, error: Error | null): ConnectionStatus {
  if (isPending) return { state: 'loading' };
  if (data) return { state: 'ready', requestId: data.requestId };
  const known = error instanceof ControlPlaneError || error instanceof RuntimeConfigError;
  return { state: 'error', message: known ? error.message : 'Không thể kiểm tra Control Plane.', ...(error instanceof ControlPlaneError && error.requestId ? { requestId: error.requestId } : {}) };
}

export function ControlPlaneStatus() {
  const query = useQuery(readinessQuery());
  const status = toStatus(query.isPending, query.data, query.error);
  return <section className="panel" aria-labelledby="control-plane-heading" aria-live="polite">
    <div className="panel-heading"><h2 id="control-plane-heading">Kết nối Control Plane</h2>
      {status.state === 'loading' && <StatusBadge tone="neutral">Đang kiểm tra</StatusBadge>}
      {status.state === 'ready' && <StatusBadge tone="positive">Sẵn sàng</StatusBadge>}
      {status.state === 'error' && <StatusBadge tone="negative">Cần kiểm tra</StatusBadge>}
    </div>
    {status.state === 'loading' && <p>Đang xác nhận dịch vụ nền tảng…</p>}
    {status.state === 'ready' && <><p>Dashboard có thể liên lạc với dịch vụ nền tảng.</p><p className="support-id">Mã hỗ trợ: {status.requestId}</p></>}
    {status.state === 'error' && <><p>{status.message}</p>{status.requestId && <p className="support-id">Mã hỗ trợ: {status.requestId}</p>}<Button type="button" onClick={() => void query.refetch()}>Thử lại</Button></>}
  </section>;
}
