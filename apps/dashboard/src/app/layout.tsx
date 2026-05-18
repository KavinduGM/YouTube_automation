import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { getMe } from '@/lib/api';

export const metadata: Metadata = {
  title: 'YouTube Automation',
  description: 'Approve and schedule YouTube content across channels',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  const user = me?.user;
  const isAdmin = user?.role === 'admin';
  const isEditor = user?.role === 'editor';
  return (
    <html lang="en">
      <body>
        {user && (
          <nav className="nav">
            <strong>YT Automation</strong>
            {isAdmin && (
              <>
                <Link href="/inbox">Inbox</Link>
                <Link href="/items">Items</Link>
                <Link href="/tasks">Tasks</Link>
                <Link href="/schedule">Schedule</Link>
                <Link href="/channels">Channels</Link>
                <Link href="/users">Users</Link>
              </>
            )}
            {isAdmin && (
              <Link href="/channel-months">Months</Link>
            )}
            {isEditor && (
              <Link href="/editor/tasks">My tasks</Link>
            )}
            <span className="spacer" />
            <span className="muted">{user.username} <small>({user.role})</small></span>
            <form action="/api/auth/logout" method="post" style={{ display: 'inline' }}>
              <button className="btn small secondary" type="submit">Sign out</button>
            </form>
          </nav>
        )}
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
