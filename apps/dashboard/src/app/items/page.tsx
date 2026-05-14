import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import { fmtDateTime, statusBadge } from '@/lib/format';

interface Item {
  id: string;
  title: string;
  type: string;
  status: string;
  expectedFilename: string;
  scheduledPublishAt: string;
  youtubeUrl: string | null;
  channel: { name: string };
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: { status?: string; channelId?: string; type?: string };
}) {
  const me = await getMe();
  if (!me?.user) redirect('/login');

  const qs = new URLSearchParams();
  if (searchParams.status) qs.set('status', searchParams.status);
  if (searchParams.channelId) qs.set('channelId', searchParams.channelId);
  if (searchParams.type) qs.set('type', searchParams.type);
  qs.set('take', '200');

  const data = await apiGet<{ items: Item[]; total: number }>(`/items?${qs.toString()}`);

  const statuses = [
    'planned', 'uploaded', 'pending_approval', 'approved',
    'scheduling', 'scheduled', 'published', 'failed', 'rejected', 'canceled',
  ];

  return (
    <>
      <h1>Items <span className="muted">({data.total})</span></h1>
      <div className="card">
        <form method="get" className="row">
          <div>
            <label>Status</label>
            <select name="status" defaultValue={searchParams.status ?? ''}>
              <option value="">All</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label>Type</label>
            <select name="type" defaultValue={searchParams.type ?? ''}>
              <option value="">All</option>
              <option value="long">long</option>
              <option value="short">short</option>
              <option value="post">post</option>
            </select>
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn" type="submit">Filter</button>
          </div>
        </form>
      </div>

      <table>
        <thead>
          <tr>
            <th>Channel</th>
            <th>Type</th>
            <th>Title</th>
            <th>Status</th>
            <th>Scheduled</th>
            <th>YouTube</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it) => (
            <tr key={it.id}>
              <td>{it.channel.name}</td>
              <td>{it.type}</td>
              <td>{it.title}</td>
              <td><span className={`badge`} style={{ background: 'transparent' }}><span className={statusBadge(it.status)} style={{ padding: '2px 8px', borderRadius: 999, fontSize: 12 }}>{it.status}</span></span></td>
              <td>{fmtDateTime(it.scheduledPublishAt)}</td>
              <td>{it.youtubeUrl ? <a href={it.youtubeUrl} target="_blank" rel="noreferrer">link</a> : '—'}</td>
              <td><Link className="btn small secondary" href={`/items/${it.id}`}>Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
