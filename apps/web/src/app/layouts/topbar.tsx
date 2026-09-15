import type { ReactNode } from 'react';
export function Topbar({ children }: { children?: ReactNode }) { return <header className="topbar"><div className="mobile-brand" aria-label="Reup Dubbing Studio"><span className="product-glyph" aria-hidden="true">R</span><span>Reup Dubbing Studio</span></div>{children}</header>; }
