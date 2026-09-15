import { Link } from 'react-router-dom';
export function NotFoundPage() { return <div className="page"><p className="eyebrow">404</p><h1>Không tìm thấy trang</h1><p className="lede">Đường dẫn bạn mở không tồn tại trong Dashboard.</p><Link className="text-link" to="/">Về trang nền tảng</Link></div>; }
