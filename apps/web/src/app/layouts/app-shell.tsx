import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Button } from '../../shared/ui/button';
import { SidebarNav } from './sidebar-nav';
import { Topbar } from './topbar';

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return <div className="app-shell"><a className="skip-link" href="#main-content">Đi đến nội dung chính</a><aside className="desktop-sidebar" aria-label="Điều hướng ứng dụng"><SidebarNav /></aside><Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}><Topbar><Dialog.Trigger asChild><Button className="menu-trigger" variant="quiet" aria-label="Mở điều hướng"><span aria-hidden="true">☰</span><span>Menu</span></Button></Dialog.Trigger></Topbar><Dialog.Portal><Dialog.Overlay className="drawer-overlay" /><Dialog.Content className="mobile-drawer" aria-describedby={undefined}><Dialog.Title className="sr-only">Điều hướng ứng dụng</Dialog.Title><Dialog.Close asChild><Button className="drawer-close" variant="quiet" aria-label="Đóng điều hướng">×</Button></Dialog.Close><SidebarNav onNavigate={() => setMobileOpen(false)} /></Dialog.Content></Dialog.Portal></Dialog.Root><main id="main-content" className="main-content" tabIndex={-1}><Outlet /></main></div>;
}
