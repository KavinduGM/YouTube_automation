import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

interface InboxItem {
  id: string;
  title: string;
  type: 'long' | 'short' | 'post';
  expectedFilename: string;
  scheduledPublishAt: string;
  uploadedAt: string | null;
  channel: { name: string; slug: string };
}

export default async function InboxPage() {
  const me = await getMe();
  if (!me?.user) redirect('/login');

  const data = await apiGet<{ items: InboxItem[] }>('/items/inbox');
  return (
    <>
      <h1>Inbox <span className="muted">— pending approval</span></h1>
      {data.items.length === 0 ? (
        <div className="card"><p className="muted">Nothing waiting. New uploads appear here automatically once the watcher picks them up.</p></div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>Type</th>
              <th>Title</th>
              <th>Filename</th>
              <th>Scheduled</th>
              <th>Uploaded</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.id}>
                <td>{it.channel.name}</td>
                <td>{it.type}</td>
                <td>{it.title}</td>
                <td><code>{it.expectedFilename}</code></td>
                <td>{fmtDateTime(it.scheduledPublishAt)}</td>
                <td>{it.uploadedAt ? fmtDateTime(it.uploadedAt) : '—'}</td>
                <td><Link className="btn small" href={`/items/${it.id}`}>Review</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted" style={{ marginTop: 12 }}>Times shown in America/New_York.</p>
    </>
  );
}
