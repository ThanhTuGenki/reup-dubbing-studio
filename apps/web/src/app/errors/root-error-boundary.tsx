import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export class RootErrorBoundary extends Component<PropsWithChildren, { hasError: boolean }> {
  public override state = { hasError: false };
  public static getDerivedStateFromError() { return { hasError: true }; }
  public override componentDidCatch(_error: Error, _info: ErrorInfo) { /* Safe telemetry is intentionally not configured. */ }
  public override render(): ReactNode {
    if (this.state.hasError) return <main className="fatal-fallback"><div className="fallback-card" role="alert"><p className="eyebrow">Reup Dubbing Studio</p><h1>Ứng dụng chưa thể hiển thị</h1><p>Hãy tải lại trang. Nếu lỗi vẫn tiếp diễn, liên hệ người vận hành hệ thống.</p><Button type="button" onClick={() => window.location.reload()}>Tải lại trang</Button></div></main>;
    return this.props.children;
  }
}
