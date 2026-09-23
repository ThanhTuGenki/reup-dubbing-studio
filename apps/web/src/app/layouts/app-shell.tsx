import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { Topbar } from './topbar';

function getInitialSidebarOpen() {
  if (window.innerWidth < 1180) return false;
  const savedState = document.cookie.match(/(?:^|; )sidebar_state=(true|false)(?:;|$)/)?.[1];
  return savedState === undefined ? true : savedState === 'true';
}

export function AppShell() {
  return (
    <SidebarProvider defaultOpen={getInitialSidebarOpen()}>
      <a className="skip-link" href="#main-content">Đi đến nội dung chính</a>
      <AppSidebar />
      <SidebarInset className="app-shell-main" id="main-content" tabIndex={-1}>
        <Topbar />
        <div className="main-content"><Suspense fallback={<div className="page" role="status" aria-live="polite">Đang tải màn hình…</div>}><Outlet /></Suspense></div>
      </SidebarInset>
    </SidebarProvider>
  );
}
