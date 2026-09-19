import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { SidebarNav } from './sidebar-nav';
import { Topbar } from './topbar';

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return <div className="app-shell"><a className="skip-link" href="#main-content">Đi đến nội dung chính</a><aside className="desktop-sidebar" aria-label="Điều hướng ứng dụng"><SidebarNav /></aside><Sheet open={mobileOpen} onOpenChange={setMobileOpen}><Topbar><SheetTrigger asChild><Button className="menu-trigger" variant="outline" aria-label="Mở điều hướng"><span aria-hidden="true">☰</span><span>Menu</span></Button></SheetTrigger></Topbar><SheetContent className="mobile-drawer" side="left" showCloseButton={false} aria-describedby={undefined}><SheetTitle className="sr-only">Điều hướng ứng dụng</SheetTitle><SheetClose asChild><Button className="drawer-close" variant="ghost" size="icon-sm" aria-label="Đóng điều hướng">×</Button></SheetClose><SidebarNav onNavigate={() => setMobileOpen(false)} /></SheetContent></Sheet><main id="main-content" className="main-content" tabIndex={-1}><Outlet /></main></div>;
}
