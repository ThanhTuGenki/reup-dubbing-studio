import { ChevronRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { resolveRouteBreadcrumbs, resolveRouteMetadata } from '../router/route-metadata';
import { AppCommandPalette } from './app-command-palette';

function NavigationTrigger() {
  const { isMobile, openMobile, state } = useSidebar();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(openMobile);
  const label = isMobile
    ? 'Mở điều hướng'
    : state === 'expanded' ? 'Thu gọn điều hướng' : 'Mở rộng điều hướng';

  useEffect(() => {
    if (isMobile && wasOpen.current && !openMobile) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
    wasOpen.current = openMobile;
  }, [isMobile, openMobile]);

  return <SidebarTrigger aria-label={label} className="navigation-trigger" ref={triggerRef} title={label} />;
}

export function Topbar() {
  const location = useLocation();
  const metadata = resolveRouteMetadata(location.pathname);
  const breadcrumbs = resolveRouteBreadcrumbs(location.pathname);

  useEffect(() => {
    document.title = `Reup Dubbing Studio — ${metadata.label}`;
  }, [metadata.label]);

  return (
    <header className="topbar">
      <NavigationTrigger />
      <div aria-label="Breadcrumb" className="breadcrumb">
        <span>Reup Dubbing Studio</span>
        {breadcrumbs.map((item, index) => <span className="breadcrumb-item" key={`${item.label}:${index}`}><ChevronRight aria-hidden="true" />{item.path ? <Link to={item.path}>{item.label}</Link> : <strong>{item.label}</strong>}</span>)}
      </div>
      <AppCommandPalette />
    </header>
  );
}
