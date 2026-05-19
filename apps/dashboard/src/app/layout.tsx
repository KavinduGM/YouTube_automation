import type { Metadata, Viewport } from 'next';
import './globals.css';
import Link from 'next/link';
import { getMe } from '@/lib/api';
import MobileNav from '@/components/MobileNav';

export const metadata: Metadata = {
  title: 'YT Automation',
  description: 'Approve and schedule YouTube content across channels',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  appleWebApp: {
    capable: true,
    title: 'YT Auto',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  const user = me?.user;
  const isAdmin = user?.role === 'admin';
  const isEditor = user?.role === 'editor';

  if (!user) {
    return (
      <html lang="en">
        <body>
          <main className="main no-sidebar">{children}</main>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body>
        <MobileNav />
        <div className="app">
          <aside className="sidebar" id="sidebar">
            <div className="brand"><span className="dot" /> YT Automation</div>
            {isAdmin && (
              <>
                <div className="nav-section">Overview</div>
                <Link className="nav-link" href="/dashboard">Dashboard</Link>
                <div className="nav-section">Review</div>
                <Link className="nav-link" href="/inbox">Inbox</Link>
                <Link className="nav-link" href="/items">Items</Link>
                <div className="nav-section">Operations</div>
                <Link className="nav-link" href="/tasks">Editor tasks</Link>
                <Link className="nav-link" href="/schedule">Schedule</Link>
                <div className="nav-section">Setup</div>
                <Link className="nav-link" href="/channels">Channels</Link>
                <Link className="nav-link" href="/channel-months">Monthly folders</Link>
                <Link className="nav-link" href="/users">Users</Link>
              </>
            )}
            {isEditor && (
              <>
                <div className="nav-section">Overview</div>
                <Link className="nav-link" href="/dashboard">Dashboard</Link>
                <div className="nav-section">Editing</div>
                <Link className="nav-link" href="/editor/tasks">My tasks</Link>
              </>
            )}
            <div className="who">
              <div style={{ fontWeight: 600, color: 'var(--fg)' }}>{user.username}</div>
              <div style={{ marginTop: 2 }}>{user.role}</div>
              <form action="/api/auth/logout" method="post" style={{ marginTop: 10 }}>
                <button type="submit" className="btn small secondary" style={{ width: '100%' }}>Sign out</button>
              </form>
            </div>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
