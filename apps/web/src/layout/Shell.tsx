import type { ReactNode } from 'react';
import { ConnectionBanner } from '../components/ConnectionBanner.tsx';
import { Navigation } from './Navigation.tsx';

export function Shell({ children, header }: { children: ReactNode; header?: ReactNode }) {
  return (
    <div className="shell">
      <Navigation />
      <div className="shell-main">
        {header}
        <ConnectionBanner />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
