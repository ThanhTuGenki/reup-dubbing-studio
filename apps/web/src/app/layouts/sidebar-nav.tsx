import { NavLink } from 'react-router-dom';
import { paths } from '../router/paths';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return <div className="sidebar-content"><div className="product-mark" aria-label="Reup Dubbing Studio"><span className="product-glyph" aria-hidden="true">R</span><span className="product-name">Reup Dubbing Studio</span></div><nav aria-label="Điều hướng chính"><NavLink className={({ isActive }) => `nav-link${isActive ? ' nav-link-active' : ''}`} end onClick={onNavigate} to={paths.foundation}><span aria-hidden="true">⌂</span><span>Nền tảng</span><span className="active-marker">Hiện tại</span></NavLink></nav></div>;
}
