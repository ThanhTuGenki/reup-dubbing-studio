import type { LucideIcon } from 'lucide-react';
import {
  Compass,
  Cpu,
  LayoutDashboard,
  Library,
  ListTodo,
  Mic2,
  Send,
  Settings,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import { Link, NavLink, useMatch } from 'react-router-dom';
import brandMark from '@/assets/brand/brand-mark-rd.svg';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { paths } from '../router/paths';
import { navigationGroups, type RouteMetadata } from '../router/route-metadata';

const navigationIcons: Record<string, LucideIcon> = {
  [paths.foundation]: LayoutDashboard,
  [paths.discovery]: Compass,
  [paths.queue]: ListTodo,
  [paths.library]: Library,
  [paths.publishing]: Send,
  [paths.channelProfiles]: SlidersHorizontal,
  [paths.voices]: Mic2,
  [paths.workers]: Cpu,
  [paths.settings]: Settings,
};

function AppSidebarLink({ item }: { item: RouteMetadata }) {
  const { setOpenMobile } = useSidebar();
  const matchPath = item.end ? item.path : `${item.path}/*`;
  const isActive = Boolean(useMatch({ path: matchPath, end: item.end ?? false }));
  const Icon = navigationIcons[item.path];

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        className="app-sidebar-menu-button"
        isActive={isActive}
        tooltip={item.label}
      >
        <NavLink
          onClick={() => setOpenMobile(false)}
          to={item.path}
          {...(item.end === undefined ? {} : { end: item.end })}
        >
          {Icon && <Icon aria-hidden="true" />}
          <span>{item.label}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AppSidebarHeaderTrigger() {
  const { isMobile } = useSidebar();
  const label = isMobile ? 'Đóng điều hướng' : 'Thu gọn thanh bên';
  return <SidebarTrigger aria-label={label} className="app-sidebar-header-trigger" title={label} />;
}

export function AppSidebar() {
  return (
    <Sidebar aria-label="Điều hướng ứng dụng" className="app-sidebar" collapsible="icon">
      <SidebarHeader className="app-sidebar-header">
        <Link className="app-brand" to={paths.foundation}>
          <img alt="" height="30" src={brandMark} width="30" />
          <span className="app-brand-copy">
            <strong>Reup Dubbing</strong>
            <span>Studio vận hành</span>
          </span>
        </Link>
        <AppSidebarHeaderTrigger />
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label="Điều hướng chính">
          {navigationGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="app-sidebar-group-label">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => <AppSidebarLink item={item} key={item.path} />)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>

      <SidebarFooter className="app-sidebar-footer">
        <div className="app-workspace-summary">
          <UserRound aria-hidden="true" />
          <span>
            <strong>Studio vận hành</strong>
            <span>Single workspace</span>
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
