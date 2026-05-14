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
  const signedIn = Boolean(me?.user);
  return (
    <html lang="en">
      <body>
        {signedIn && (
          <nav className="nav">
            <strong>YT Automation</strong>
            <Link href="/inbox">Inbox</Link>
            <Link href="/items">Items</Link>
            <Link href="/items/new">New item</Link>
            <Link href="/channels">Channels</Link>
            <span className="spacer" />
            <span className="muted">{me?.user?.email}</span>
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
